import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/jwt.js';

const generateToken = (id) => {
  return jwt.sign({ id }, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRE || '30d',
  });
};

export default generateToken;
