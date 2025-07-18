const jwt = require('jsonwebtoken');
const {
  normalizePhone,
  getUserByEmailOrPhone,
  insertUser,
  setOtp,
  verifyOtp,
  clearOtp,
  updateUserMetadata,
  getUserMetadata,
  markUserAsRegistered,
  updateUserRole 
} = require('../services/userService');

exports.login = async (req, res) => {
  const { email, phone: rawPhone } = req.body;
  const phone = normalizePhone(rawPhone);

  if (!email && !phone) {
    return res.status(400).json({ error: 'Provide email or phone' });
  }

  try {
    let user = await getUserByEmailOrPhone(email, phone);
    if (!user) user = await insertUser(email, phone);

    const otp = await setOtp(user.id);
    console.log(`OTP sent to ${email || phone}: ${otp}`);

    res.json({ message: 'OTP sent', status: user.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.verifyOtp = async (req, res) => {
  const { email, phone: rawPhone, otp } = req.body;
  const phone = normalizePhone(rawPhone);

  if (!otp || (!email && !phone)) {
    return res.status(400).json({ error: 'OTP and email/phone required' });
  }

  try {
    const user = await getUserByEmailOrPhone(email, phone);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.status === 'blocked') return res.status(403).json({ error: 'User is blocked' });

    const isValid = await verifyOtp(user.id, otp.toString());
    if (!isValid) return res.status(401).json({ error: 'Invalid OTP' });

    await clearOtp(user.id);

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'defaultsecret', {
      expiresIn: '1h',
    });

    res.json({
      message: 'OTP verified',
      token,
      userId: user.id,
      status: user.status
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.register = async (req, res) => {
  const {
    email,
    phone: rawPhone,
    firstName,
    middleName,
    lastName,
    dob,
    gender,
    role
  } = req.body;

  const phone = normalizePhone(rawPhone);
  const allowedGenders = ['male', 'female', 'other'];
  const allowedRoles = ['client', 'lawyer', 'expert', 'ngo'];

  if (!firstName || !lastName || !dob || !gender || !role) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!allowedGenders.includes(gender.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid gender' });
  }

  if (!allowedRoles.includes(role.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const user = await getUserByEmailOrPhone(email, phone);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await updateUserMetadata(user.id, {
      first_name: firstName,
      middle_name: middleName || '',
      last_name: lastName,
      dob,
      gender: gender.toLowerCase()
    });

    await updateUserRole(user.id, role.toLowerCase());

    await markUserAsRegistered(user.id);

    res.json({ message: 'Registration completed successfully', userId: user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
