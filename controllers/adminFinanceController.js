const {
  fetchFinanceSummary,
  fetchPartnerPayoutSummary,
} = require("../services/adminFinanceService");

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
      from: req.query.from || req.query.date_from,
      to: req.query.to || req.query.date_to,
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

exports.getPartnerPayoutSummary = async (_req, res) => {
  try {
    const data = await fetchPartnerPayoutSummary();

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
