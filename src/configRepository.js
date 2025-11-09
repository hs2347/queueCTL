const { withDataLocked, readData } = require("./db");

function getConfig(key, defaultValue = null) {
  const data = readData();
  if (!Object.prototype.hasOwnProperty.call(data.config, key)) {
    return defaultValue;
  }
  return data.config[key];
}

function setConfig(key, value) {
  withDataLocked((data) => {
    data.config[key] = String(value);
  });
}

function getIntConfig(key, defaultValue) {
  const val = getConfig(key, null);
  if (val === null) return defaultValue;
  const n = Number(val);
  return Number.isFinite(n) ? n : defaultValue;
}

function getBoolConfig(key, defaultValue) {
  const val = getConfig(key, null);
  if (val === null) return defaultValue;
  return val === "1" || val === "true" || val === "yes";
}

module.exports = {
  getConfig,
  setConfig,
  getIntConfig,
  getBoolConfig,
};
