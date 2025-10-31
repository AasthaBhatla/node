const {
  getWalletByUserId,
  reduceWalletBalance,
} = require("../services/walletService");

exports.getByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const wallet = await getWalletByUserId(userId);
    if (!wallet) return res.status(404).json({ error: "Wallet not found" });
    res.json(wallet);
  } catch (err) {
    console.error("Error in getByUserId wallet:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.reduceBalance = async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const updatedWallet = await reduceWalletBalance(userId, amount);
    res.json({
      message: "Balance reduced successfully",
      data: updatedWallet,
    });
  } catch (err) {
    console.error("Error in reduceBalance wallet:", err);
    res.status(400).json({ error: err.message });
  }
};
