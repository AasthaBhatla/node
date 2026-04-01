const {
  createUserWalletCreditForAdmin,
  createUserWalletPayoutForAdmin,
  getUserWalletBalanceForAdmin,
  getUserWalletTransactionsForAdmin,
  getUserWalletSessionGroupsForAdmin,
} = require("../services/adminWalletService");

function failure(res, statusCode, message) {
  return res.status(statusCode).json({
    status: "failure",
    body: { message },
  });
}

exports.getUserBalance = async (req, res) => {
  try {
    const userId = parseInt(req.params.user_id, 10);
    const data = await getUserWalletBalanceForAdmin(userId);

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

exports.getUserTransactions = async (req, res) => {
  try {
    const userId = parseInt(req.params.user_id, 10);
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    const data = await getUserWalletTransactionsForAdmin({
      userId,
      limit,
      offset,
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

exports.getUserSessionGroups = async (req, res) => {
  try {
    const userId = parseInt(req.params.user_id, 10);
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    const data = await getUserWalletSessionGroupsForAdmin({
      userId,
      limit,
      offset,
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

exports.createUserPayout = async (req, res) => {
  try {
    const userId = parseInt(req.params.user_id, 10);
    const amountCredits = req.body?.amount_credits;
    const note = req.body?.note;

    const data = await createUserWalletPayoutForAdmin({
      userId,
      amountCredits,
      note,
      adminUser: req.user,
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

exports.createUserCredit = async (req, res) => {
  try {
    const userId = parseInt(req.params.user_id, 10);
    const amountCredits = req.body?.amount_credits;
    const title = req.body?.title;
    const note = req.body?.note;

    const data = await createUserWalletCreditForAdmin({
      userId,
      amountCredits,
      title,
      note,
      adminUser: req.user,
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
