import express from 'express';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cors from 'cors';

// Load environment variables early
dotenv.config();

const app = express();

// Set PORT from .env or default to 5000
const PORT = process.env.PORT || 5000;

// 1. Security Middlewares
// helmet(): Sets secure HTTP headers (protects against XSS, clickjacking, hides 'X-Powered-By: Express')
app.use(helmet());

// cors(): Restricts API access to trusted domains and allows HTTP cookies/authorization headers
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

// 2. Built-in Body Parsers
app.use(express.json());                                // Parses incoming JSON payloads into req.body
app.use(express.urlencoded({ extended: true }));       // Parses incoming URL-encoded form data into req.body

// 3. Health Check / Basic Route
app.get("/", (req, res) => {
  res.json({ message: `Server running on port ${PORT}` });
});

// 4. Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;