module.exports = async function () {
  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { ok: true, ts: new Date().toISOString() }
  };
};
