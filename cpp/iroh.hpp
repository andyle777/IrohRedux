// IrohRedux for C++ — header-only client (C++17).
//
// Trace JavaScript at runtime from C++, through the IrohRedux CLI
// (`cli/iroh.js`): the client writes your JavaScript to a temporary file,
// runs the CLI on it, and parses the JSON lines the CLI streams back.
//
//   #include "iroh.hpp"
//   iroh::Client client;
//   auto trace = client.run(
//     "function factorial(n) {"
//     "  if (n === 0) return 1;"
//     "  return n * factorial(n - 1);"
//     "}; factorial(3);",
//     {"CALL", "IF"});
//   for (const auto& e : trace.events) {
//     if (e["event"].as_string() == "FUNCTION_CALL")
//       std::cout << "called with " << e["arguments"].as_array()[0].as_number();
//   }
//   std::cout << "result: " << trace.result.as_number();  // 6
//
// No third-party dependencies: the header includes a minimal JSON parser
// (objects, arrays, strings, numbers, booleans, null) sufficient for the
// CLI's output. Requires Node.js and an IrohRedux checkout (or IROH_CLI).
//
// Environment:
//   IROH_CLI  — path to cli/iroh.js (default: found relative to the
//               working directory: ./cli/iroh.js, then ../cli/iroh.js).
//   IROH_NODE — Node binary (default: "node").
#pragma once

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <stdexcept>
#include <string>
#include <unistd.h>
#include <utility>
#include <variant>
#include <vector>

namespace iroh {

// ---------------------------------------------------------------------------
// Minimal JSON value + parser (enough for the CLI's JSON lines).
// ---------------------------------------------------------------------------
struct Json {
  using Array = std::vector<Json>;
  using Object = std::vector<std::pair<std::string, Json>>;
  using Value = std::variant<std::nullptr_t, bool, double, std::string, Array, Object>;

  Value value = nullptr;

  bool is_null() const { return std::holds_alternative<std::nullptr_t>(value); }
  bool is_bool() const { return std::holds_alternative<bool>(value); }
  bool is_number() const { return std::holds_alternative<double>(value); }
  bool is_string() const { return std::holds_alternative<std::string>(value); }
  bool is_array() const { return std::holds_alternative<Array>(value); }
  bool is_object() const { return std::holds_alternative<Object>(value); }

  bool as_bool() const { return std::get<bool>(value); }
  double as_number() const { return std::get<double>(value); }
  const std::string& as_string() const { return std::get<std::string>(value); }
  const Array& as_array() const { return std::get<Array>(value); }
  const Object& as_object() const { return std::get<Object>(value); }

  // Object lookup by key; returns a null Json when absent.
  const Json& operator[](const std::string& key) const {
    static const Json kNull;
    if (!is_object()) return kNull;
    for (const auto& kv : as_object()) {
      if (kv.first == key) return kv.second;
    }
    return kNull;
  }
  bool has(const std::string& key) const {
    if (!is_object()) return false;
    for (const auto& kv : as_object()) {
      if (kv.first == key) return true;
    }
    return false;
  }
};

namespace detail {

inline void append_utf8(std::string& out, unsigned cp) {
  if (cp < 0x80) {
    out += static_cast<char>(cp);
  } else if (cp < 0x800) {
    out += static_cast<char>(0xC0 | (cp >> 6));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  } else if (cp < 0x10000) {
    out += static_cast<char>(0xE0 | (cp >> 12));
    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  } else {
    out += static_cast<char>(0xF0 | (cp >> 18));
    out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  }
}

class JsonParser {
 public:
  explicit JsonParser(const std::string& text) : text_(text) {}

  Json parse() {
    Json v = parse_value();
    skip_ws();
    if (pos_ != text_.size()) fail("trailing characters");
    return v;
  }

 private:
  const std::string& text_;
  std::size_t pos_ = 0;

  [[noreturn]] void fail(const std::string& what) const {
    throw std::runtime_error("JSON parse error at offset " + std::to_string(pos_) + ": " + what);
  }
  void skip_ws() {
    while (pos_ < text_.size() &&
           (text_[pos_] == ' ' || text_[pos_] == '\t' || text_[pos_] == '\n' || text_[pos_] == '\r')) {
      ++pos_;
    }
  }
  char peek() {
    if (pos_ >= text_.size()) fail("unexpected end of input");
    return text_[pos_];
  }
  bool consume(char c) {
    if (pos_ < text_.size() && text_[pos_] == c) {
      ++pos_;
      return true;
    }
    return false;
  }
  void expect(char c) {
    if (!consume(c)) fail(std::string("expected '") + c + "'");
  }
  void expect_lit(const char* lit) {
    for (const char* p = lit; *p; ++p) {
      if (pos_ >= text_.size() || text_[pos_] != *p) fail(std::string("expected '") + lit + "'");
      ++pos_;
    }
  }

  Json parse_value() {
    skip_ws();
    char c = peek();
    if (c == '{') return parse_object();
    if (c == '[') return parse_array();
    if (c == '"') {
      Json v;
      v.value = parse_string();
      return v;
    }
    if (c == 't') {
      expect_lit("true");
      Json v;
      v.value = true;
      return v;
    }
    if (c == 'f') {
      expect_lit("false");
      Json v;
      v.value = false;
      return v;
    }
    if (c == 'n') {
      expect_lit("null");
      return Json{};
    }
    return parse_number();
  }

  Json parse_object() {
    expect('{');
    Json::Object obj;
    skip_ws();
    if (consume('}')) {
      Json v;
      v.value = std::move(obj);
      return v;
    }
    while (true) {
      skip_ws();
      if (peek() != '"') fail("expected object key");
      std::string key = parse_string();
      skip_ws();
      expect(':');
      Json val = parse_value();
      obj.emplace_back(std::move(key), std::move(val));
      skip_ws();
      if (consume('}')) break;
      expect(',');
    }
    Json v;
    v.value = std::move(obj);
    return v;
  }

  Json parse_array() {
    expect('[');
    Json::Array arr;
    skip_ws();
    if (consume(']')) {
      Json v;
      v.value = std::move(arr);
      return v;
    }
    while (true) {
      arr.push_back(parse_value());
      skip_ws();
      if (consume(']')) break;
      expect(',');
    }
    Json v;
    v.value = std::move(arr);
    return v;
  }

  unsigned parse_hex4() {
    if (pos_ + 4 > text_.size()) fail("bad \\u escape");
    unsigned cp = 0;
    for (int i = 0; i < 4; ++i) {
      char c = text_[pos_++];
      cp <<= 4;
      if (c >= '0' && c <= '9') cp |= static_cast<unsigned>(c - '0');
      else if (c >= 'a' && c <= 'f') cp |= static_cast<unsigned>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') cp |= static_cast<unsigned>(c - 'A' + 10);
      else fail("bad hex digit in \\u escape");
    }
    return cp;
  }

  std::string parse_string() {
    expect('"');
    std::string out;
    while (true) {
      if (pos_ >= text_.size()) fail("unterminated string");
      char c = text_[pos_++];
      if (c == '"') break;
      if (c == '\\') {
        if (pos_ >= text_.size()) fail("unterminated escape");
        char e = text_[pos_++];
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            unsigned cp = parse_hex4();
            // Surrogate pair.
            if (cp >= 0xD800 && cp <= 0xDBFF && pos_ + 1 < text_.size() &&
                text_[pos_] == '\\' && text_[pos_ + 1] == 'u') {
              pos_ += 2;
              unsigned lo = parse_hex4();
              if (lo >= 0xDC00 && lo <= 0xDFFF) {
                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
              } else {
                fail("bad low surrogate");
              }
            }
            append_utf8(out, cp);
            break;
          }
          default: fail("bad escape");
        }
      } else {
        out += c;
      }
    }
    return out;
  }

  Json parse_number() {
    std::size_t start = pos_;
    if (peek() == '-') ++pos_;
    while (pos_ < text_.size() &&
           ((text_[pos_] >= '0' && text_[pos_] <= '9') || text_[pos_] == '.' ||
            text_[pos_] == 'e' || text_[pos_] == 'E' || text_[pos_] == '+' || text_[pos_] == '-')) {
      ++pos_;
    }
    if (pos_ == start) fail("expected a value");
    Json v;
    v.value = std::stod(text_.substr(start, pos_ - start));
    return v;
  }
};

inline std::string shell_quote(const std::string& s) {
  // Single-quote for POSIX shells, escaping embedded single quotes.
  std::string out = "'";
  for (char c : s) {
    if (c == '\'') out += "'\\''";
    else out += c;
  }
  out += "'";
  return out;
}

inline bool file_exists(const std::string& p) {
  std::ifstream f(p);
  return f.good();
}

}  // namespace detail

// ---------------------------------------------------------------------------
// Client.
// ---------------------------------------------------------------------------
class TraceError : public std::runtime_error {
 public:
  std::string name;
  std::vector<Json> events;  // events that fired before the failure

  TraceError(const std::string& message, const std::string& error_name,
             std::vector<Json> prior_events)
      : std::runtime_error(message), name(error_name), events(std::move(prior_events)) {}
};

struct Trace {
  std::vector<Json> events;
  Json result;
  bool has_result = false;
};

class Client {
 public:
  Client() : cli_(find_cli()), node_(env_or("IROH_NODE", "node")) {}

  explicit Client(std::string cli_path, std::string node = "node")
      : cli_(std::move(cli_path)), node_(std::move(node)) {}

  const std::string& cli_path() const { return cli_; }

  Trace run(const std::string& code, const std::vector<std::string>& events = {}) {
    std::string tmp = write_temp_file(code);
    try {
      return run_cli(tmp, events);
    } catch (...) {
      std::remove(tmp.c_str());
      throw;
    }
    std::remove(tmp.c_str());
  }

  Trace run_file(const std::string& path, const std::vector<std::string>& events = {}) {
    return run_cli(path, events);
  }

 private:
  std::string cli_;
  std::string node_;

  static std::string env_or(const char* name, const std::string& fallback) {
    const char* v = std::getenv(name);
    return (v && *v) ? v : fallback;
  }

  static std::string find_cli() {
    const char* env = std::getenv("IROH_CLI");
    if (env && *env) return env;
    for (const char* candidate : {"./cli/iroh.js", "../cli/iroh.js", "../../cli/iroh.js"}) {
      if (detail::file_exists(candidate)) return candidate;
    }
    throw TraceError(
        "Could not find the IrohRedux CLI (cli/iroh.js). Set IROH_CLI to its path.",
        "CliNotFound", {});
  }

  static std::string write_temp_file(const std::string& code) {
    // mkstemp requires the template to end in exactly "XXXXXX".
    std::string pattern = "/tmp/iroh-XXXXXX";
    std::vector<char> buf(pattern.begin(), pattern.end());
    buf.push_back('\0');
    int fd = mkstemp(buf.data());
    if (fd < 0) throw std::runtime_error("could not create temporary file");
    std::string tmp(buf.data());
    {
      std::ofstream out(tmp, std::ios::binary);
      out << code;
      if (!out) {
        close(fd);
        std::remove(tmp.c_str());
        throw std::runtime_error("could not write temporary file");
      }
    }
    close(fd);
    return tmp;
  }

  Trace run_cli(const std::string& file, const std::vector<std::string>& events) {
    std::string cmd = detail::shell_quote(node_) + " " + detail::shell_quote(cli_) +
                      " --file " + detail::shell_quote(file);
    if (!events.empty()) {
      std::string joined;
      for (std::size_t i = 0; i < events.size(); ++i) {
        if (i) joined += ",";
        joined += events[i];
      }
      cmd += " --events " + detail::shell_quote(joined);
    }
    cmd += " 2>/dev/null";
    FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe) throw std::runtime_error("could not run the Iroh CLI");

    Trace trace;
    char buffer[8192];
    std::string line;
    int status = 0;
    while (std::fgets(buffer, sizeof(buffer), pipe) != nullptr) {
      line += buffer;
      if (!line.empty() && line.back() == '\n') {
        handle_line(line, trace);
        line.clear();
      }
    }
    if (!line.empty()) handle_line(line, trace);
    status = pclose(pipe);
    if (status != 0 && trace.events.empty() && !trace.has_result) {
      throw TraceError("iroh CLI exited with status " + std::to_string(status),
                       "CliFailed", trace.events);
    }
    return trace;
  }

  static void handle_line(const std::string& line, Trace& trace) {
    if (line.find_first_not_of(" \t\r\n") == std::string::npos) return;
    Json item = detail::JsonParser(line).parse();
    if (!item["type"].is_string()) return;
    std::string type = item["type"].as_string();
    if (type == "event") {
      trace.events.push_back(std::move(item));
    } else if (type == "result") {
      trace.result = item["value"];
      trace.has_result = true;
    } else if (type == "error") {
      std::string message = item["message"].is_string() ? item["message"].as_string() : "Unknown error";
      std::string name = item["name"].is_string() ? item["name"].as_string() : "";
      throw TraceError(message, name, trace.events);
    }
  }
};

}  // namespace iroh
