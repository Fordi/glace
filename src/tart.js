((global, factory)=>{
  if (global.Redux && global.Glace) {
    global.Tart = factory(Redux, Glace);
  } else if (global.define && global.define.amd) {
    global.define(['Redux', './glace'], factory);
  }
})(this, (Redux, Glace) => {
  return (root, template, reducer) => {
    let store = Redux.createStore(reducer);
    Glace.append(root, template, store);
    return store;
  }
});
