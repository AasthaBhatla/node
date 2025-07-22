const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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
  getUserById,
  getUsers,
  getUserProfileById
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

    const deviceToken = crypto.randomBytes(8).toString('hex');
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
    if (!user || user.id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }

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
  const { email, phone: rawPhone } = req.body;
  const phone = normalizePhone(rawPhone);

  if (!email && !phone) {
    return res.status(400).json({ error: 'Provide email or phone' });
  }

  try {
    let user = await getUserByEmailOrPhone(email, phone);
    if (!user) {
      user = await insertUser(email, phone);
    }

    const otp = await setOtp(user.id);
    console.log(`OTP resent to ${email || phone}: ${otp}`);

    res.json({
      message: 'OTP resent successfully',
      status: user.status,
    });
  } catch (err) {
    console.error('Resend OTP Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
exports.getMe = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await getUserById(userId); 
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const metadata = await getUserMetadata(userId); 
    res.json({ ...user, metadata });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
exports.updateMe = async (req, res) => {
  const userId = req.user.id;
  const {
    firstName,
    middleName,
    lastName,
    dob,
    gender,
    role
  } = req.body;

  const allowedGenders = ['male', 'female', 'other'];
  const allowedRoles = ['client', 'lawyer', 'expert', 'ngo'];

  if (gender && !allowedGenders.includes(gender.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid gender' });
  }

  if (role && !allowedRoles.includes(role.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await updateUserMetadata(userId, {
      ...(firstName && { first_name: firstName }),
      ...(middleName && { middle_name: middleName }),
      ...(lastName && { last_name: lastName }),
      ...(dob && { dob }),
      ...(gender && { gender: gender.toLowerCase() })
    });

    if (role) {
      await updateUserRole(userId, role.toLowerCase());
    }

    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Update user profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
exports.getUsers = async (req, res) => {
  try {
    const {
      role,
      status,
      count,
      page,
      orderBy,
      order,
      email,
      phone,
      search,
      withMetadata
    } = req.query;

    const metaQuery = req.query.metaQuery
      ? JSON.parse(req.query.metaQuery)
      : undefined;

    const filters = {
      role,
      status,
      count: parseInt(count) || 10,
      page: parseInt(page) || 1,
      orderBy,
      order,
      email,
      phone,
      search,
      withMetadata: withMetadata === 'true',
      metaQuery,
    };

    const users = await getUsers(filters);
    res.status(200).json({ users });
  } catch (err) {
    console.error('Error in getUsers controller:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};
exports.getUserById = async (req, res) => {
  const userId = req.params.id;

  try {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const metadata = await getUserMetadata(userId); 
    res.json({ ...user, metadata });
  } catch (err) {
    console.error('Get user by ID error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
exports.updateUserMetaByAdmin = async (req, res) => {
  const requestingUser = req.user;
  const targetUserId = req.params.id;
  const { firstName, middleName, lastName, dob, gender, role } = req.body;

  const allowedGenders = ['male', 'female', 'other'];
  const allowedRoles = ['client', 'lawyer', 'expert', 'ngo', 'admin'];

  if (gender && !allowedGenders.includes(gender.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid gender' });
  }

  if (role && !allowedRoles.includes(role.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    if (requestingUser.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update other users\' metadata' });
    }

    const user = await getUserById(targetUserId);
    if (!user) return res.status(404).json({ error: 'Target user not found' });

    await updateUserMetadata(targetUserId, {
      ...(firstName && { first_name: firstName }),
      ...(middleName && { middle_name: middleName }),
      ...(lastName && { last_name: lastName }),
      ...(dob && { dob }),
      ...(gender && { gender: gender.toLowerCase() }),
    });

    if (role) {
      await updateUserRole(targetUserId, role.toLowerCase());
    }

    res.json({ message: 'User metadata updated by admin successfully' });
  } catch (err) {
    console.error('Update user meta by admin error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

