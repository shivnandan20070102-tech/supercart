const MIN_JWT_SECRET_LENGTH = 32;

export const getJwtSecret = () => {
  const secret = String(process.env.JWT_SECRET || '');
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET is required and must be at least ${MIN_JWT_SECRET_LENGTH} characters long`);
  }
  return secret;
};
