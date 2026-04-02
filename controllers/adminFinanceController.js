const { fetchFinanceSummary } = require("../services/adminFinanceService");

function failure(res, statusCode, message) {
  return res.status(statusCode).json({
    status: "failure",
    body: { message },
  });
}

exports.getSummary = async (req, res) => {
  try {
    const data = await fetchFinanceSummary({
      range: req.query.range,
      timeZone: req.query.tz || req.query.timeZone,
    });

    return res.status(200).json({
      status: "success",
      body: data,
    });
  } catch (error) {
    return failure(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
    );
  }
};
