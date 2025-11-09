function logInfo(...args) {
  console.log("[INFO]", ...args);
}

function logWarn(...args) {
  console.warn("[WARN]", ...args);
}

function logError(...args) {
  console.error("[ERROR]", ...args);
}

module.exports = {
  logInfo,
  logWarn,
  logError,
};
