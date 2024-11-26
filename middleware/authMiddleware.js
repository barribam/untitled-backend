const jwt = require('jsonwebtoken');

// Middleware function to extract JWT from Authorization header
const extractJwtFromHeader = (req, res, next) => {
    // Get the Authorization header
    const authHeader = req.headers['authorization'];
    
    // Check if the header exists and starts with "Bearer "
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // Extract the token part
      const token = authHeader.split(' ')[1];
      req.token = token; // Attach the token to the request object for use in later middleware or route handlers
      next(); // Proceed to the next middleware or route handler
    } else {
      res.status(401).json({ message: 'Authorization token not found or invalid' });
    }
};

// Define your secret key (keep this safe in production)
const secretKey = process.env.JWT_SECRET_KEY

// Middleware function to verify JWT
const verifyJwt = (req, res, next) => {
  // Get the Authorization header
  const authHeader = req.headers['authorization'];
  
  // Check if the header exists and starts with "Bearer "
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token not found or invalid' });
  }
  
  // Extract the token from the header
  const token = authHeader.split(' ')[1];

  // Verify the token
  jwt.verify(token, secretKey, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Failed to authenticate token' });
    }
    
    // If the token is valid, attach the decoded user info to the request object
    req.user = decoded;
    next(); // Call the next middleware or route handler
  });
};

module.exports = { extractJwtFromHeader, verifyJwt}