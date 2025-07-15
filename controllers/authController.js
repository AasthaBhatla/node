const pool = require('../db');
const jwt = require('jsonwebtoken');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

exports.requestOtp = async (req, res) => {
  const { email, phone } = req.body;

  if (!email && !phone) {
    return res.status(400).json({ error: 'Please provide email or phone' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1 OR phone = $2`,
      [email || null, phone || null]
    );
    let user = result.rows[0];

    if (!user) {
      const insertResult = await pool.query(
        `INSERT INTO users (email, phone, status) VALUES ($1, $2, $3) RETURNING *`,
        [email || null, phone || null, 'registered']
      );
      user = insertResult.rows[0];
    }

    const otp = generateOtp();

    await pool.query(
      `UPDATE users SET otp = $1, status = 'registered' WHERE id = $2`,
      [otp, user.id]
    );

    console.log(`OTP sent to ${email || phone}: ${otp}`);
    res.json({ message: `OTP sent to ${email || phone}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.verifyOtp = async (req, res) => {
  const { email, phone, otp } = req.body;

  if (!otp || (!email && !phone)) {
    return res.status(400).json({ error: 'OTP and identifier required' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1 OR phone = $2`,
      [email || null, phone || null]
    );
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.status === 'blocked') return res.status(403).json({ error: 'User is blocked' });
    if (user.otp !== otp) return res.status(401).json({ error: 'Invalid OTP' });

    await pool.query(`UPDATE users SET status = 'verified', otp = NULL WHERE id = $1`, [user.id]);

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.json({ message: 'OTP verified', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
