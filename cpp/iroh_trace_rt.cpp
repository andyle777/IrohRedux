// IrohRedux native C++ tracer runtime (0.9.0) — function-level only.
//
// Compile the USER'S program with -finstrument-functions; compile THIS
// file WITHOUT it (the hooks must live in a separate uninstrumented
// translation unit — defining them in the instrumented file fails with
// "ambiguates built-in declaration", and no_instrument_function alone
// does not fix it). Link both together with -rdynamic so dladdr can
// resolve the program's own (non-exported) function names.
//
//   g++ -std=c++17 -O0 -finstrument-functions -rdynamic -g prog.cpp \
//       iroh_trace_rt.cpp -o prog -ldl
//   ./prog            # events on stderr, program output on stdout
//
// The hooks emit one JSON line per function entry/exit on file
// descriptor 2 (stderr), in the same shape the JavaScript CLI emits,
// so Iroh.analyze() works unchanged across languages:
//
//   {"type":"event","event":"FUNCTION_ENTER","category":"FUNCTION",
//    "trigger":"enter","hash":140234567890,"indent":0,
//    "name":"main","address":"0x5555555551a9","file":"prog.cpp"}
//
// v1 is FUNCTION-LEVEL ONLY: -finstrument-functions gives no
// line/loop/branch events, so a C++ trace has no LOOP_TEST, IF_TEST or
// CATCH_ENTER events — the scorecard scores that honestly (lower
// coverage is a finding, not a failure; HOT_LOOP and friends cannot
// fire on a C++ trace, and DEEP_RECURSION can). Function names come
// from dladdr + __cxa_demangle; when a name cannot be resolved the
// event carries "name":null and the raw "address" — never a faked name.
//
// Noise filter (v1): functions whose demangled name starts with
// "std::" are template/library internals instantiated in the user's
// translation unit, not the user's code — their enter/exit pairs are
// skipped entirely (they do not count toward call depth either). The
// test parses the MANGLED name's outermost qualifier (see
// classify_mangled): a user function that merely takes or returns a
// std type is kept, and a std internal stays filtered even when its
// name carries template arguments. Names that dladdr cannot resolve
// (lambdas, static and anonymous-namespace functions are local
// symbols) fall back to the executable's .symtab, parsed lazily from
// /proc/self/exe; only a stripped binary still yields null.
// The program's own stdout is untouched; its stderr shares the event
// channel, so a traced program that writes to stderr will mix
// non-JSON lines into the event stream — the CLI driver skips lines
// that do not parse as event JSON.
//
// -O0 is used by the driver on purpose: at higher optimization levels
// the compiler inlines small functions, and inlined functions get no
// hooks at all. Only one translation unit is supported in v1 (a
// single .cpp file); headers it includes are fine.
//
// No dependencies beyond the C++ standard library and dladdr.

#include <cxxabi.h>
#include <cstdlib>
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

namespace {

// Depth of user-code frames currently entered (main counts as 0).
// A small stack records, per entered frame, whether its events were
// emitted — enter/exit pairs must stay matched even when a frame's
// events were filtered out. It grows (doubling) because a fixed cap
// corrupts pairing past it: enters beyond the cap do not push, but
// exits still pop, so every later exit reads the wrong frame's flag.
int g_depth = 0;
bool* g_emitted = nullptr;
size_t g_emitted_cap = 0;
int g_stack_top = 0;

bool push_emitted(bool emitted) {
  if ((size_t)g_stack_top >= g_emitted_cap) {
    size_t next = g_emitted_cap ? g_emitted_cap * 2 : 1024;
    bool* grown = (bool*)realloc(g_emitted, next * sizeof(bool));
    if (!grown) return false;  // out of memory: no record stored
    g_emitted = grown;
    g_emitted_cap = next;
  }
  g_emitted[g_stack_top++] = emitted;
  return true;
}

void write_all(int fd, const char* buf, size_t len) {
  while (len > 0) {
    ssize_t n = write(fd, buf, len);
    if (n <= 0) return;
    buf += n;
    len -= (size_t)n;
  }
}

// Append a JSON-escaped string (with quotes) to buf; returns the new end.
char* json_string(char* out, const char* s) {
  *out++ = '"';
  for (const unsigned char* p = (const unsigned char*)s; *p; ++p) {
    unsigned char c = *p;
    if (c == '"') { *out++ = '\\'; *out++ = '"'; }
    else if (c == '\\') { *out++ = '\\'; *out++ = '\\'; }
    else if (c == '\n') { *out++ = '\\'; *out++ = 'n'; }
    else if (c == '\r') { *out++ = '\\'; *out++ = 'r'; }
    else if (c == '\t') { *out++ = '\\'; *out++ = 't'; }
    else if (c < 0x20) { out += snprintf(out, 8, "\\u%04x", c); }
    else *out++ = (char)c;
  }
  *out++ = '"';
  return out;
}


// --- .symtab fallback -----------------------------------------------------
// dladdr only sees dynamic symbols, so lambdas, static functions and
// anonymous-namespace functions resolve to null even though their
// symbols are in the executable's .symtab. Lazily parse /proc/self/exe
// (ELF64, little-endian) once, collect the STT_FUNC symbols, and binary
// search by address. When the binary is stripped or unparseable the
// fallback is empty and names stay null, as before. The file buffer is
// kept for the life of the process: symbol names point into it.
struct FuncSym {
  uintptr_t addr;
  uintptr_t size;
  const char* name;  // mangled; demangled by resolve_name as usual
};

FuncSym* g_syms = nullptr;
size_t g_syms_len = 0;
bool g_syms_tried = false;
char* g_symtab_data = nullptr;  // kept alive; g_syms[i].name points here

uint16_t rd16(const unsigned char* p) {
  uint16_t v;
  memcpy(&v, p, 2);
  return v;
}
uint32_t rd32(const unsigned char* p) {
  uint32_t v;
  memcpy(&v, p, 4);
  return v;
}
uint64_t rd64(const unsigned char* p) {
  uint64_t v;
  memcpy(&v, p, 8);
  return v;
}

int cmp_sym(const void* a, const void* b) {
  uintptr_t x = ((const FuncSym*)a)->addr;
  uintptr_t y = ((const FuncSym*)b)->addr;
  return x < y ? -1 : x > y ? 1 : 0;
}

void load_symtab() {
  if (g_syms_tried) return;
  g_syms_tried = true;
  FILE* f = fopen("/proc/self/exe", "rb");
  if (!f) return;
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  if (size < 64) { fclose(f); return; }
  fseek(f, 0, SEEK_SET);
  char* data = (char*)malloc((size_t)size);
  if (!data) { fclose(f); return; }
  if (fread(data, 1, (size_t)size, f) != (size_t)size) {
    free(data);
    fclose(f);
    return;
  }
  fclose(f);
  const unsigned char* bytes = (const unsigned char*)data;
  // ELF64, little-endian only (the platforms this tracer runs on).
  if (memcmp(bytes, "\x7f" "ELF", 4) != 0 || bytes[4] != 2 || bytes[5] != 1) {
    free(data);
    return;
  }
  uint16_t e_type = rd16(bytes + 16);       // ET_EXEC(2) / ET_DYN(3)
  uint64_t e_shoff = rd64(bytes + 40);      // section header table
  uint16_t e_shentsize = rd16(bytes + 58);
  uint16_t e_shnum = rd16(bytes + 60);
  if (e_shoff == 0 || e_shentsize < 64 || e_shnum == 0 ||
      e_shoff + (uint64_t)e_shentsize * e_shnum > (uint64_t)size) {
    free(data);
    return;
  }
  // Find the SHT_SYMTAB section (type 2); its sh_link is the strtab.
  const unsigned char* symtab = nullptr;
  uint64_t symtab_size = 0, symtab_entsize = 0;
  uint32_t symtab_link = 0;
  for (uint16_t i = 0; i < e_shnum; ++i) {
    const unsigned char* sh = bytes + e_shoff + (uint64_t)i * e_shentsize;
    if (rd32(sh + 4) != 2) continue;  // SHT_SYMTAB
    uint64_t off = rd64(sh + 24);
    uint64_t sz = rd64(sh + 32);
    if (off + sz > (uint64_t)size) continue;
    symtab = bytes + off;
    symtab_size = sz;
    symtab_entsize = rd64(sh + 56);
    symtab_link = rd32(sh + 40);
    break;
  }
  if (!symtab || symtab_entsize < 24 || symtab_link >= e_shnum) {
    free(data);
    return;
  }
  const unsigned char* str_sh =
      bytes + e_shoff + (uint64_t)symtab_link * e_shentsize;
  uint64_t str_off = rd64(str_sh + 24);
  uint64_t str_size = rd64(str_sh + 32);
  if (str_off + str_size > (uint64_t)size) {
    free(data);
    return;
  }
  const char* strtab = data + str_off;
  // Load bias for ET_DYN (PIE): st_value is a link-time address.
  // The runtime is linked into the traced executable, so dladdr of a
  // runtime function gives the executable's base.
  uintptr_t bias = 0;
  if (e_type == 3) {
    Dl_info info;
    if (dladdr((void*)load_symtab, &info) != 0) {
      bias = (uintptr_t)info.dli_fbase;
    }
  }
  size_t count = (size_t)(symtab_size / symtab_entsize);
  FuncSym* syms = (FuncSym*)malloc(count * sizeof(FuncSym));
  if (!syms) {
    free(data);
    return;
  }
  size_t kept = 0;
  for (size_t i = 0; i < count; ++i) {
    const unsigned char* sym = symtab + i * symtab_entsize;
    uint32_t st_name = rd32(sym + 0);
    unsigned char st_info = sym[4];
    uint16_t st_shndx = rd16(sym + 6);
    uint64_t st_value = rd64(sym + 8);
    uint64_t st_size = rd64(sym + 16);
    if ((st_info & 0xf) != 2) continue;   // STT_FUNC only
    if (st_shndx == 0 || st_value == 0) continue;  // undefined
    if (st_name >= str_size) continue;
    const char* name = strtab + st_name;
    if (!*name) continue;
    syms[kept].addr = (uintptr_t)st_value + bias;
    syms[kept].size = (uintptr_t)st_size;
    syms[kept].name = name;
    ++kept;
  }
  if (kept == 0) {
    free(syms);
    free(data);
    return;
  }
  qsort(syms, kept, sizeof(FuncSym), cmp_sym);
  g_syms = syms;
  g_syms_len = kept;
  g_symtab_data = data;  // kept: names point into it
}

// The mangled .symtab name for `fn`, or null. The candidate is the
// function whose [addr, addr + size) contains fn (or, for a size-0
// symbol, the one starting exactly at fn).
const char* lookup_symtab(void* fn) {
  load_symtab();
  if (!g_syms || g_syms_len == 0) return nullptr;
  uintptr_t addr = (uintptr_t)fn;
  size_t lo = 0, hi = g_syms_len;
  while (lo < hi) {
    size_t mid = (lo + hi) / 2;
    if (g_syms[mid].addr <= addr) lo = mid + 1;
    else hi = mid;
  }
  if (lo == 0) return nullptr;
  const FuncSym& s = g_syms[lo - 1];
  if (s.size == 0 ? addr != s.addr : addr >= s.addr + s.size) {
    return nullptr;
  }
  return s.name;
}


// Resolve `fn` to a display name. Returns true when a name was found
// (demangled when possible); the name is written into `name_buf`, and
// the mangled name (for the filter) into `*mangled_out` when given.
bool resolve_name(void* fn, char* name_buf, size_t name_size,
                  const char** file_out, const char** mangled_out) {
  Dl_info info;
  const char* mangled = nullptr;
  if (dladdr(fn, &info) != 0) {
    if (file_out) *file_out = info.dli_fname;
    mangled = info.dli_sname;
  }
  if (!mangled) mangled = lookup_symtab(fn);  // .symtab fallback
  if (!mangled) return false;
  if (mangled_out) *mangled_out = mangled;
  int status = 0;
  char* demangled = abi::__cxa_demangle(mangled, nullptr, nullptr, &status);
  if (status == 0 && demangled) {
    snprintf(name_buf, name_size, "%s", demangled);
    free(demangled);
    return true;
  }
  snprintf(name_buf, name_size, "%s", mangled);
  return true;
}

void emit(const char* event, const char* category, const char* trigger,
          void* fn, const char* name, const char* file, int indent) {
  // {"type":"event","event":...,"category":...,"trigger":...,"hash":N,
  //  "indent":N,"name":...,"address":"0x...","file":...}
  char buf[4096];
  char* p = buf;
  p += snprintf(p, (size_t)(buf + sizeof(buf) - p),
                "{\"type\":\"event\",\"event\":");
  p = json_string(p, event);
  p += snprintf(p, (size_t)(buf + sizeof(buf) - p), ",\"category\":");
  p = json_string(p, category);
  p += snprintf(p, (size_t)(buf + sizeof(buf) - p), ",\"trigger\":");
  p = json_string(p, trigger);
  p += snprintf(p, (size_t)(buf + sizeof(buf) - p),
                ",\"hash\":%llu,\"indent\":%d",
                (unsigned long long)(uintptr_t)fn, indent);
  if (name) {
    p += snprintf(p, (size_t)(buf + sizeof(buf) - p), ",\"name\":");
    p = json_string(p, name);
  } else {
    p += snprintf(p, (size_t)(buf + sizeof(buf) - p), ",\"name\":null");
  }
  char addr[32];
  snprintf(addr, sizeof(addr), "0x%llx", (unsigned long long)(uintptr_t)fn);
  p += snprintf(p, (size_t)(buf + sizeof(buf) - p), ",\"address\":");
  p = json_string(p, addr);
  if (file) {
    // Basename only — the full path is machine-specific noise.
    const char* base = strrchr(file, '/');
    base = base ? base + 1 : file;
    p += snprintf(p, (size_t)(buf + sizeof(buf) - p), ",\"file\":");
    p = json_string(p, base);
  }
  p += snprintf(p, (size_t)(buf + sizeof(buf) - p), "}\n");
  write_all(2, buf, (size_t)(p - buf));
}

}  // namespace

// The instrumentation hooks. They live in this uninstrumented file, so
// they never hook themselves. They must not call any function defined
// in the instrumented program — only libc/libstdc++ (dladdr,
// __cxa_demangle, snprintf, write).
extern "C" {

// --- Itanium mangled-name filter ------------------------------------------
// Decide whether a MANGLED function name belongs to the standard library
// or a compiler-detail namespace, by parsing the Itanium prefix. The
// demangled string cannot answer this reliably: the return type and the
// template arguments sit in front of (and around) the function's own
// qualified name, so testing the demangled string drops user functions
// that take or return a std type ("greet(std::string)") and keeps std
// internals whose names carry template arguments ("...::basic_string<...>
// ::basic_string(...)"). The mangled name is precise: the outermost
// qualifier is the first component of the name. Only the head is
// parsed — no template-argument skipping is ever needed, because the
// verdict is decided by the first component alone.
// Returns 1 = std::__ (filter), 0 = user code (keep).
int classify_component_head(const char* p) {
  if (!p || !*p) return 0;
  if (p[0] == 'S') {
    // A substitution. "St" is std::; any other substitution at the head
    // cannot be resolved without a full parse — keep.
    return p[1] == 't' ? 1 : 0;
  }
  if (p[0] >= '0' && p[0] <= '9') {
    // Source name: <length><chars> — the outermost qualifier.
    int len = 0;
    const char* q = p;
    while (*q >= '0' && *q <= '9') {
      len = len * 10 + (*q - '0');
      ++q;
    }
    if (len >= 2 && q[0] == '_' && q[1] == '_') return 1;  // __ detail
    return 0;
  }
  // An operator name, or anything else: a global operator or a plain
  // (C-linkage) name — user code.
  return 0;
}

int classify_name_body(const char* p) {
  if (!p || !*p) return 0;
  // Thunks (Th/Tv <offset> _): skip to the real name. (Tc thunks carry
  // two offsets, so they are left unparsed — and kept, which is the
  // safe direction for a filter: a kept std thunk is noise, a dropped
  // user function is a bug.)
  if (p[0] == 'T' && (p[1] == 'h' || p[1] == 'v')) {
    const char* q = p + 2;
    if (*q == 'n') ++q;
    while (*q >= '0' && *q <= '9') ++q;
    if (*q == '_') return classify_name_body(q + 1);
    return 0;
  }
  if (p[0] == 'Z') {
    // Local name: Z <enclosing-encoding> E <entity>. The enclosing
    // function's head decides — a lambda inside main is user code, a
    // lambda inside a std function is std noise.
    return classify_name_body(p + 1);
  }
  if (p[0] == 'N') {
    // Nested name: N [CV/ref qualifiers] <prefix> <unqualified> E.
    // The first prefix component is the outermost qualifier.
    ++p;
    while (*p == 'K' || *p == 'V' || *p == 'r' || *p == 'R' || *p == 'O') ++p;
    return classify_component_head(p);
  }
  return classify_component_head(p);
}

int classify_mangled(const char* mangled) {
  if (!mangled || !*mangled) return 0;
  // GCC's translation-unit static initialisers (_GLOBAL__sub_I_*,
  // _GLOBAL__sub_D_*, _GLOBAL__I_*) are compiler-generated, not user
  // calls — but they begin with a single "_GLOBAL__", so neither the
  // Itanium _Z rule nor the plain "__" rule catches them, and the top
  // frame of every GCC trace was static init instead of user code.
  // Filter them explicitly. This cannot catch a user function in an
  // anonymous namespace: that symbol is _ZN12_GLOBAL__N_1..., which
  // starts with _Z, not _GLOBAL__.
  if (strncmp(mangled, "_GLOBAL__", 9) == 0) return 1;
  if (mangled[0] == '_' && mangled[1] == 'Z') {
    return classify_name_body(mangled + 2);  // Itanium mangled name
  }
  // A plain (C-linkage) symbol: "main", "printf", "helper". Only a
  // "__" prefix is a compiler/runtime internal.
  return (mangled[0] == '_' && mangled[1] == '_') ? 1 : 0;
}

void __cyg_profile_func_enter(void* this_fn, void* /* call_site */) {
  char name[1024];
  const char* file = nullptr;
  const char* mangled = nullptr;
  bool named = resolve_name(this_fn, name, sizeof(name), &file, &mangled);
  // Filter on the MANGLED name: the demangled string cannot tell a
  // std internal from a user function that takes or returns a std
  // type (see classify_mangled). An unresolved name (null) is kept —
  // it is the program's own code on a stripped binary, not noise.
  bool filtered = named && classify_mangled(mangled);
  // If the record cannot be stored (out of memory), the matching exit
  // cannot pop it — it assumes the frame was emitted, which keeps the
  // depth balanced at the cost of possibly emitting one extra pair.
  // The run is doomed on OOM anyway; pairing stays exact otherwise.
  bool pushed = push_emitted(!filtered);
  (void)pushed;
  if (filtered) return;
  int indent = g_depth;
  emit("FUNCTION_CALL", "CALL", "before", this_fn,
       named ? name : nullptr, file, indent);
  emit("FUNCTION_ENTER", "FUNCTION", "enter", this_fn,
       named ? name : nullptr, file, indent);
  g_depth += 1;
}

void __cyg_profile_func_exit(void* this_fn, void* /* call_site */) {
  bool emitted = true;
  if (g_stack_top > 0) emitted = g_emitted[--g_stack_top];
  if (!emitted) return;
  g_depth -= 1;
  if (g_depth < 0) g_depth = 0;
  char name[1024];
  const char* file = nullptr;
  const char* mangled = nullptr;
  bool named = resolve_name(this_fn, name, sizeof(name), &file, &mangled);
  emit("FUNCTION_CALL_END", "CALL", "after", this_fn,
       named ? name : nullptr, file, g_depth);
  emit("FUNCTION_LEAVE", "FUNCTION", "leave", this_fn,
       named ? name : nullptr, file, g_depth);
}

}  // extern "C"
