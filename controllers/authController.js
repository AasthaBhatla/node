const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
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
  updateUserRole,
  saveDeviceToken,
  removeDeviceToken,
  getUserById
} = require('../services/userService');

exports.login = async (req, res) => {
  const { email, phone: rawPhone, deviceToken } = req.body;
  const phone = normalizePhone(rawPhone);

  if (!email && !phone) {
    return res.status(400).json({ error: 'Provide email or phone' });
  }

  if (!deviceToken) {
    return res.status(400).json({ error: 'Device token is required' });
  }

  try {
    let user = await getUserByEmailOrPhone(email, phone);
    if (!user) user = await insertUser(email, phone);

    await saveDeviceToken(user.id, deviceToken); 

    const otp = await setOtp(user.id);
    console.log(`OTP sent to ${email || phone}: ${otp}`);

    res.json({ message: 'OTP sent', deviceToken, status: user.status });
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
    firstName,
    middleName,
    lastName,
    dob,
    gender,
    role
  } = req.body;

  const allowedGenders = ['male', 'female', 'other'];
  const allowedRoles = ['client', 'lawyer', 'expert', 'ngo', 'admin'];

  if (!firstName || !lastName || !dob || !gender || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!allowedGenders.includes(gender.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid gender' });
  }

  if (!allowedRoles.includes(role.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const user = req.user;
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }

    await updateUserMetadata(user.id, {
      first_name: firstName,
      middle_name: middleName || '',
      last_name: lastName,
      dob,
      gender
    });
    await updateUserRole(user.id, role.toLowerCase());

    await markUserAsRegistered(user.id); 
    return res.status(200).json({ message: 'Registration completed successfully' });

  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

exports.logout = async (req, res) => {
  const { deviceToken } = req.body;

  if (!deviceToken) {
    return res.status(400).json({ error: 'Device token is required' });
  }

  try {
    const userId = req.user.id;
    await removeDeviceToken(userId, deviceToken);
    return res.json({ message: 'Logout successful' });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

exports.resendOtp = async (req, res) => {
  const { email, phone: rawPhone, deviceToken } = req.body;
  const phone = normalizePhone(rawPhone);

  if (!email && !phone) {
    return res.status(400).json({ error: 'Provide email or phone' });
  }

  if (!deviceToken) {
    return res.status(400).json({ error: 'Device token is required' });
  }

  try {
    let user = await getUserByEmailOrPhone(email, phone);
    if (!user) {
      user = await insertUser(email, phone);
    }

    await saveDeviceToken(user.id, deviceToken); // Save the provided device token

    const otp = await setOtp(user.id);
    console.log(`OTP resent to ${email || phone}: ${otp}`);

    res.json({
      message: 'OTP resent successfully',
      deviceToken,
      status: user.status,
    });
  } catch (err) {
    console.error('Resend OTP Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
