import { v4 as uuidv4 } from 'uuid';

export const generateId = (): string => uuidv4();

export const generateShortId = (): string => uuidv4().slice(0, 8);
