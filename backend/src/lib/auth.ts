import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { username } from 'better-auth/plugins';
import { bearer } from 'better-auth/plugins';

import { prisma } from './prisma';
import { env } from '../config/env';

export const auth = betterAuth({
  basePath: '/auth',
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, {
    provider: 'postgresql'
  }),
  emailAndPassword: {
    enabled: true
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 50
    }),
    bearer()
  ],
  user: {
    additionalFields: {
      isAdmin: {
        type: 'boolean',
        defaultValue: false,
        input: false
      },
      showCardNumbers: {
        type: 'boolean',
        defaultValue: true,
        input: false
      },
      showPricing: {
        type: 'boolean',
        defaultValue: true,
        input: false
      },
      enabledYugioh: {
        type: 'boolean',
        defaultValue: true,
        input: false
      },
      enabledMagic: {
        type: 'boolean',
        defaultValue: true,
        input: false
      },
      enabledPokemon: {
        type: 'boolean',
        defaultValue: true,
        input: false
      },
      defaultGame: {
        type: 'string',
        required: false,
        input: false
      }
    }
  }
});
