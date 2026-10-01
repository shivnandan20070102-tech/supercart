import jwt from 'jsonwebtoken';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'supersecret_jwt_key_grocery_app_12345', {
    expiresIn: process.env.JWT_EXPIRE || '30d',
  });
};

export default generateToken;
