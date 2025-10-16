module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: {
      success: true,
      version: "minimal-probe",
      message: "Function is registered and reachable."
    }
  };
};
