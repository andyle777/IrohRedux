import extend from "./extend";

import Stage from "./stage/index";
import Scope from "./scope";
import Frame from "./frame";

import * as _utils from "./utils";
import * as _setup from "./setup";
import * as _analyze from "./analyze";
import * as _neurons from "./neurons";
import * as _vectors from "./vectors";
import * as _scan from "./scan";
import * as _live from "./live";
import * as _direct from "./direct";
import * as _translate from "./translate";

class Iroh {
  constructor() {
    // patch AST scope
    this.scope = null;
    // patch stage
    this.stage = null;
    // patch state
    this.state = null;
    // stage instance
    this.instance = null;
    // container for all stages
    this.stages = {};
    // enter setup phase
    this.setup();
    // say hello
    this.greet();
  }
};

// link methods to main class
extend(Iroh, _utils);
extend(Iroh, _setup);
extend(Iroh, _analyze);
extend(Iroh, _neurons);
extend(Iroh, _vectors);
extend(Iroh, _scan);
extend(Iroh, _live);
extend(Iroh, _direct);
extend(Iroh, _translate);

const iroh = new Iroh();

// intercept Stage instantiations
let _Stage = function() {
  let stage = new Stage(...arguments);
  // register stage to iroh stages
  // so we can keep track of it
  iroh.stages[stage.key] = stage;
  return stage;
};
_Stage.prototype = Object.create(Stage.prototype);
iroh.Stage = _Stage;

// link to outer space
if (typeof window !== "undefined") {
  window.Iroh = iroh;
}

export default iroh;
