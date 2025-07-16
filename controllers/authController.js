const pool = require('../db');
const jwt = require('jsonwebtoken');

// Normalize phone to format +91XXXXXXXXXX
const normalizePhone = (phone) => {
  if (!phone) return null;
  phone = phone.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = phone.slice(1);
  if (!phone.startsWith('91')) phone = '91' + phone;
  return '+' + phone;
};

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

// 1. LOGIN (Send OTP)
exports.login = async (req, res) => {
  const { email, phone: rawPhone } = req.body;
  const phone = normalizePhone(rawPhone);

  if (!email && !phone) {
    return res.status(400).json({ error: 'Provide email or phone' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1 OR phone = $2`,
      [email || null, phone || null]
    );
    let user = result.rows[0];
    let statusMessage = 'registered';

    if (!user) {
      const insertResult = await pool.query(
        `INSERT INTO users (email, phone, status) VALUES ($1, $2, 'new') RETURNING *`,
        [email || null, phone || null]
      );
      user = insertResult.rows[0];
      statusMessage = 'new user';
    }

    const otp = generateOtp();
    await pool.query(`UPDATE users SET otp = $1 WHERE id = $2`, [otp, user.id]);
    console.log(`OTP sent to ${email || phone}: ${otp}`);

    res.json({ message: `OTP sent to ${email || phone}`, status: statusMessage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// 2. VERIFY OTP
exports.verifyOtp = async (req, res) => {
  const { email, phone: rawPhone, otp } = req.body;
  const phone = normalizePhone(rawPhone);

  if (!otp || (!email && !phone)) {
    return res.status(400).json({ error: 'OTP and email/phone required' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1 OR phone = $2`,
      [email || null, phone || null]
    );
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.status === 'blocked') return res.status(403).json({ error: 'Blocked user' });
    if (user.otp !== otp.toString()) return res.status(401).json({ error: 'Invalid OTP' });

    await pool.query(`UPDATE users SET otp = NULL WHERE id = $1`, [user.id]);

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'defaultsecret', {
      expiresIn: '1h',
    });

    res.json({ message: 'OTP verified', token, userId: user.id, status: user.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// 3. REGISTER FULL DETAILS + ROLE
exports.register = async (req, res) => {
  const {
    email,
    phone: rawPhone,
    firstName,
    middleName,
    lastName,
    dob,
    gender,
    role,
  } = req.body;

  const phone = normalizePhone(rawPhone);
  const allowedGenders = ['male', 'female', 'other'];
  const allowedRoles = ['Client', 'Lawyer', 'Expert', 'NGO'];

  if ((!email && !phone) || !firstName || !lastName || !dob || !gender || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!allowedGenders.includes(gender.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid gender' });
  }

  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1 OR phone = $2`,
      [email || null, phone || null]
    );
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.status === 'registered') {
      return res.status(400).json({ error: 'User already registered' });
    }

    await pool.query(
      `UPDATE users SET email = $1, phone = $2, role = $3, status = 'registered' WHERE id = $4`,
      [email || user.email, phone || user.phone, role, user.id]
    );

    const metadata = {
      first_name: firstName,
      middle_name: middleName || '',
      last_name: lastName,
      dob,
      gender: gender.toLowerCase(),
    };

    for (const [key, value] of Object.entries(metadata)) {
      await pool.query(
        `INSERT INTO user_metadata (user_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [user.id, key, value]
      );
    }

    res.json({ message: 'Registration completed successfully', userId: user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
