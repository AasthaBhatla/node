const express = require('express');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const app = express();

app.use(express.json());
app.use('/auth', authRoutes); 
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

