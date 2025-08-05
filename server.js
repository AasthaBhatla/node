require("dotenv").config();
const express = require("express");
const app = express();

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const requestRoutes = require('./routes/requestRoutes');

app.use(express.json());
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use('/requests', requestRoutes);

// This is a default behaviour to show that the API is working on endpiont
app.get("/", (req, res) => {
  res.json({ message: "API is working!" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

