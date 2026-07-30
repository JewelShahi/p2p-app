# Notes

# Backend Notes

## File structure

```txt
backend/
├── .env                  # Secret environment variables (DB URLs, API keys, JWT secrets)
├── package.json          # Project metadata, scripts (npm start), and dependencies
└── src/
    ├── auth/             # OAuth/Passport configuration strategies (Google, GitHub, etc.)
    ├── config/           # Setup and connections for Database (Mongoose) and 3rd party SDKs
    ├── controllers/      # Handles request/response logic and connects routes to database
    ├── middlewares/      # Security guards (auth check, role restriction, central error handling)
    ├── models/           # Database schemas and models (e.g., user.model.js)
    ├── routes/           # API URL endpoints mapped to middlewares and controllers
    ├── services/         # Core business logic and runs direct database CRUD operations (find, create, update, delete)
    ├── utils/            # Generic helper functions (email sender, token generator, date formatters)
    └── validations/      # Input field check rules for forms/requests (express-validator, Zod)

===================================================================================
FILE NAMING CONVENTIONS
===================================================================================
auth/         -> <strategy-name>.strategy.js    (e.g., google.strategy.js, passport.strategy.js)
config/       -> <thing-configured>.config.js   (e.g., db.config.js, cloudinary.config.js)
controllers/  -> <feature-name>.controller.js   (e.g., user.controller.js, auth.controller.js)
middlewares/  -> <function-type>.middleware.js  (e.g., auth.middleware.js, validate.middleware.js)
models/       -> <singular-resource>.model.js   (e.g., user.model.js, product.model.js)
routes/       -> <feature-name>.routes.js       (e.g., user.routes.js, auth.routes.js)
services/     -> <feature-name>.service.js      (e.g., user.service.js, auth.service.js)
utils/        -> <helper-action>.js             (e.g., sendEmail.js, generateToken.js)
validations/  -> <feature-name>.validation.js   (e.g., user.validation.js, auth.validation.js)
```

## Installation of Packages for Projects

### Essential
*(Install for EVERY project regardless of database or setup)*

* `npm install express` - Core web framework for setting up routes, requests, and responses
* `npm install dotenv` - Loads environment variables from your .env file into process.env

---

### High Priority: Security, Auth & Validation
*(Install for 99% of APIs)*

* `npm install cors` - Enables Cross-Origin Resource Sharing so your frontend can call your backend
* `npm install helmet` - Automatically sets HTTP security headers to protect against common web attacks
* `npm install zod` - Validates incoming request data (req.body, req.params) before reaching controllers
* `npm install express-rate-limit` - Protects routes against brute-force attacks and spam by limiting requests per IP
* `npm install bcryptjs` - Hashes (encrypts) user passwords securely before saving them to the database
* `npm install jsonwebtoken` - Generates and verifies JWT tokens for user session authentication/login

---

### Database Dependent
*(Only install if using this specific DB)*

* `npm install mongoose` - Mongoose ODM for MongoDB (DO NOT install if using PostgreSQL, MySQL, Prisma, etc.)

---

### Use-Case Dependent
*(Install ONLY when your feature requires it)*

* `npm install cookie-parser` - Parses cookies sent in request headers (required if storing JWTs in HTTP-only cookies)
* `npm install multer` - Handles file uploads (images, PDFs) sent via form-data from frontend
* `npm install nodemailer` - Sends automated emails (password resets, welcome emails) from your backend

---

### Development Only
*(Tooling to make coding easier - save as devDependency)*

* `npm install -D nodemon` - Automatically restarts server whenever you save changes to your code

#### Env setup

```txt
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/mydatabase
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3000
```

#### Server basic setup

```js
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
```

## Route management

Request -> [ 1. Route URL ] -> [ 2. Authentication ] -> [ 3. Authorization ] -> [ 4. Validation Rules ] -> [ 5. Validation Filter ] -> [ 6. Controller ]


### Admin-Only Route WITH Request Body Validation

```js
router.post(
  '/admin/create-user', // 1. Route URL
  protect, // 2. Auth: Must be logged in
  restrictTo('admin'), // 3. Role: Must be an admin
  createUserValidation, // 4. Rules: Check if body fields are valid (validation checker)
  validate, // 5. Filter: Reject if fields are invalid (validator - middleware)
  adminController.createUser // 6. Controller: Execute admin action
);
```

### Admin-Only Route WITHOUT Body Validation

```js
router.get(
  '/admin/stats',          // 1. Route URL
  protect,                 // 2. Auth: Must be logged in
  restrictTo('admin'),     // 3. Role: Must be an admin
  adminController.getStats // 4. Controller: Return data `(for this .getStats is used import like this import * as adminController from '../controllers/user.controller.js';)`
);
```

### Any Logged-In User Route WITH Body Validation

```js
router.put(
  '/profile/update',       // 1. Route URL
  protect,                 // 2. Auth: Must be logged in
  updateProfileValidation, // 3. Rules: Check if new profile fields are valid
  validate,                // 4. Filter: Reject if fields are invalid
  userController.update    // 5. Controller: Update profile
);
```

### Public Route WITH Body Validation

```js
router.post(
  '/login',                // 1. Route URL
  loginValidation,         // 2. Rules: Check email/password format
  validate,                // 3. Filter: Reject if format is invalid
  authController.login     // 4. Controller: Perform login
);
```

## Additional setup 

### Bcrypt
```js
import bcrypt from 'bcryptjs';

// 1. Hashing a password (during Registration)
const salt = await bcrypt.genSalt(10);
const hashedPassword = await bcrypt.hash(password, salt);

// 2. Checking a password (during Login)
const isMatch = await bcrypt.compare(enteredPassword, hashedPasswordFromDB);
```

# Frontend notes

## Installing React with Vite

`npm create vite@latest .` - allows installing react in the current pwd folder

## TailwindCSS, DaisyUI and port setup

### Installation of TailwindCSS and DaisyUI

`npm install tailwindcss @tailwindcss/vite` - installation of TailwindCSS newest version     
`npm install daisyui@latest` - installation of DaisyUI newest version

### Setup TailwindCSS and DaisyUI

In the vite config file add this, for the port and for the DaisyUI, react and tailwind

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000
  }
})
```

After this TailwindCSS and DaisyUI must be imported in the main css file (default in index.css, also heres the button behavior of the DaisyUI v4.12.24 button, not a big fan of the newer button animation)

```css
@import "tailwindcss";
@plugin "daisyui";

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
  outline-offset: 2px;

  transform: scale(1) translateZ(0);
  transition:
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.3s ease,
    background-color 0.3s ease,
    border-color 0.3s ease,
    color 0.3s ease;

  will-change: transform;
}

.btn:hover {
  transform: scale(1.05) translateZ(0);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
}

.btn:focus-visible {
  transform: scale(1.045) translateZ(0);
}

.btn:active {
  transform: scale(0.95) translateZ(0);
  transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}

.btn:disabled,
.btn[disabled],
.btn-disabled {
  transform: scale(1) translateZ(0);
  box-shadow: none;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .btn {
    transition: none;
  }
  .btn:hover,
  .btn:active {
    transform: none;
  }
}
```

## Installing Axios and setup

### Installation of Axios - better API fetcher

`npm install axios` - installation of axios

### Set up of axios

Setting Axios in a file `axios.js` in directory `src/api/`

```js
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api",
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ---- Request interceptor: attach auth token ----
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ---- Response interceptor: unwrap data + handle errors globally ----
api.interceptors.response.use(
  (response) => response.data, // no more res.data.data everywhere
  async (error) => {
    const { response } = error;

    if (!response) {
      // network error / server down / CORS
      console.error("Network error:", error.message);
      return Promise.reject({ message: "Network error, please try again." });
    }

    const { status, data } = response;

    switch (status) {
      case 401:
        // token expired/invalid — clear and redirect to login
        localStorage.removeItem("token");
        window.location.href = "/login";
        break;
      case 403:
        console.error("Forbidden:", data?.message);
        break;
      case 404:
        console.error("Not found:", data?.message);
        break;
      case 422:
        console.error("Validation error:", data?.errors);
        break;
      case 429:
        const retryAfter = response.headers["retry-after"];
        console.warn(`Rate limited. Retry after ${retryAfter || "some time"}s`);
        // optional: auto-retry once after the delay
        break;
      case 500:
        console.error("Server error:", data?.message);
        break;
      default:
        console.error("API error:", data?.message || error.message);
    }

    return Promise.reject(data || error);
  }
);

export default api;
```

Usage of the setup

```js
import api from "@/api/axios";

// GET
const users = await api.get("/users");

// POST
const newUser = await api.post("/users", { name: "Alice" });

// PUT / DELETE work the same way
await api.put(`/users/${id}`, { name: "Bob" });
await api.delete(`/users/${id}`);
```

## .env file

Vite doesn't need installing of .env library. Just create .env in the root folder and use this `VITE_API_URL=http://localhost:3000/api`, the name of the variable must be exactly same for this to work.

## File structure 

```txt
frontend/
├─ src/
│  ├─ api/                        # API communication with backend
│  │  └─ axios.js                 
│  ├─ assets/                     # Static files used by the app
│  │  ├─ images/                   # Product images, logos, pictures
│  │  ├─ icons/                    # SVG icons and icon files
│  │  └─ fonts/                    # Custom fonts
│  ├─ components/                 # Reusable UI components used in many pages
│  │  ├─ AnimatedBackground.jsx               
│  │  └─ ... 
│  ├─ pages/                      # Full pages/screens connected to routes
│  │  ├─ Home.jsx                
│  │  ├─ Login.jsx                
│  │  └─ ...  
│  ├─ layouts/                    # Shared page structures
│  │  ├─ Navbar.jsx            
|  |  ├─ Footer.jsx
│  │  └─ ...
│  ├─ routes/                     # React Router configuration
│  │  └─ AppRoutes.jsx
│  ├─ hooks/                      # Custom reusable React hooks
│  │  ├─ useAuth.js                
│  │  └─ ...
│  ├─ context/                    # React Context (only for simple global data)
│  │  └─ AuthContext.jsx          
│  ├─ store/                      # Redux global state management
│  │  └─ store.js                   # Main Redux store configuration
│  ├─ features/                   # Different parts of application state
│  │  ├─ theme/
│  │  │  └─ themeSlice.js
│  │  ├─ auth/
│  │  │  └─ authSlice.js
|  |  └─ ...
│  ├─ utils/                      # Small reusable helper functions
│  │  ├─ formatDate.js            
│  │  └─ ...
│  ├─ constants/                  # Values that do not change
│  ├─ App.jsx                     # Main application component
│  ├─ index.css                   # Global styles
│  └─ main.jsx                    # React entry point + Redux Provider
├─ .env                          # Environment variables (API URLs, keys)
├─ index.html                    # HTML template
├─ package.json                  # Dependencies and scripts
└─ vite.config.js                # Vite configuration
```

## Lucide React icons - better icons

`npm install lucide-react` - installation of Lucide React icons