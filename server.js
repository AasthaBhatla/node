const express = require('express');
const app = express();
require('dotenv').config();

const authRoutes = require('./routes/auth');

app.use(express.json());
app.use('/api', authRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
