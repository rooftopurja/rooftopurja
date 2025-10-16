module.exports = async function (context, req) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { ok: true, when: new Date().toISOString() }
  };
};