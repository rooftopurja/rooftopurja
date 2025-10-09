module.exports = async function () {
  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { ok: true, version: "healthcheck v2", ts: new Date().toISOString() }
  };
};


