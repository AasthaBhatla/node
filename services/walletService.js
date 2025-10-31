const pool = require("../db");

const getWalletByUserId = async (userId) => {
  try {
    const result = await pool.query(`SELECT * FROM wallet WHERE user_id = $1`, [userId]);
    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in getWalletByUserId:", err);
    throw new Error("Error fetching wallet");
  }
};

const reduceWalletBalance = async (userId, amount) => {
  try {
    if (amount <= 0) throw new Error("Amount must be positive");

    const result = await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
    if (result.rows.length === 0) throw new Error("Wallet not found");

    const currentBalance = parseFloat(result.rows[0].balance);
    if (currentBalance < amount) throw new Error("Insufficient balance");

    const newBalance = currentBalance - amount;

    const updateResult = await pool.query(
      `UPDATE wallet SET balance = $1 WHERE user_id = $2 RETURNING *`,
      [newBalance, userId]
    );

    return updateResult.rows[0];
  } catch (err) {
    console.error("Error in reduceWalletBalance:", err);
    throw err;
  }
};

const addWalletBalance = async (userId, amount) => {
  try {
    if (amount <= 0) throw new Error("Amount must be positive");

    const result = await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);

    if (result.rows.length === 0) {
      const insertResult = await pool.query(
        `INSERT INTO wallet (user_id, balance) VALUES ($1, $2) RETURNING *`,
        [userId, amount]
      );
      return insertResult.rows[0];
    } else {
      const currentBalance = parseFloat(result.rows[0].balance);
      const newBalance = currentBalance + amount;

      const updateResult = await pool.query(
        `UPDATE wallet SET balance = $1 WHERE user_id = $2 RETURNING *`,
        [newBalance, userId]
      );

      return updateResult.rows[0];
    }
  } catch (err) {
    console.error("Error in addWalletBalance:", err);
    throw err;
  }
};


module.exports = {
  getWalletByUserId,
  reduceWalletBalance,
  addWalletBalance,
};
