import { OP } from "./labels";

export function evalUnaryExpression(op, ctx, a) {
  switch (op) {
    case OP["+"]:      return +a;
    case OP["-"]:      return -a;
    case OP["!"]:      return !a;
    case OP["~"]:      return ~a;
    case OP["void"]:   return void a;
    case OP["typeof"]: return typeof a;
    // handled outside
    case OP["delete"]: return a;
    default:
      throw new Error(`Invalid operator ${op}`);
    break;
  };
};

export function evalBinaryExpression(op, a, b) {
  switch (op) {
    case OP["+"]:          return a + b;
    case OP["-"]:          return a - b;
    case OP["*"]:          return a * b;
    case OP["/"]:          return a / b;
    case OP["%"]:          return a % b;
    case OP["**"]:         return a ** b;
    case OP["<<"]:         return a << b;
    case OP[">>"]:         return a >> b;
    case OP[">>>"]:        return a >>> b;
    case OP["&"]:          return a & b;
    case OP["^"]:          return a ^ b;
    case OP["|"]:          return a | b;
    case OP["in"]:         return a in b;
    case OP["=="]:         return a == b;
    case OP["==="]:        return a === b;
    case OP["!="]:         return a != b;
    case OP["!=="]:        return a !== b;
    case OP[">"]:          return a > b;
    case OP[">="]:         return a >= b;
    case OP["<"]:          return a < b;
    case OP["<="]:         return a <= b;
    case OP["instanceof"]: return a instanceof b;
    default:
      throw new Error(`Invalid operator ${op}`);
    break;
  };
};

export function evalObjectAssignmentExpression(op, obj, prop, value) {
  switch (op) {
    case OP["="]:   return obj[prop] =    value;
    case OP["+"]:   return obj[prop] +=   value;
    case OP["-"]:   return obj[prop] -=   value;
    case OP["*"]:   return obj[prop] *=   value;
    case OP["/"]:   return obj[prop] /=   value;
    case OP["%"]:   return obj[prop] %=   value;
    case OP["**"]:  return obj[prop] **=  value;
    case OP["<<"]:  return obj[prop] <<=  value;
    case OP[">>"]:  return obj[prop] >>=  value;
    case OP[">>>"]: return obj[prop] >>>= value;
    case OP["&"]:   return obj[prop] &=   value;
    case OP["^"]:   return obj[prop] ^=   value;
    case OP["|"]:   return obj[prop] |=   value;
    // Logical assignment (ES2021). Written out longhand: the patcher
    // strips `||=` to `||` before calling here, and the right-hand value
    // was already evaluated by the caller, so these only decide whether
    // to store it. (Identifier assignments, `x ||= y`, are handled by
    // the native operator in the outer assignment instead.)
    case OP["||"]:
      if (obj[prop]) return obj[prop];
      return obj[prop] = value;
    case OP["&&"]:
      if (obj[prop]) return obj[prop] = value;
      return obj[prop];
    case OP["??"]:
      if (obj[prop] !== null && obj[prop] !== void 0) return obj[prop];
      return obj[prop] = value;
    default:
      throw new Error(`Invalid operator ${op}`);
    break;
  };
};
