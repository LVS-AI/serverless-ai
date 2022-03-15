import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error500,
  error403,
  success,
} from '@tech-matters/serverless-helpers';
import axios from 'axios';
import crypto from 'crypto';

const validateToken = require('twilio-flex-token-validator').validator;

export type Body = {
  payload: string;
  Token?: string;
  ApiKey?: string;
};

type EnvVars = {
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
  SAVE_PENDING_CONTACTS_STATIC_KEY: string;
  SAFERNET_ENDPOINT: string;
  SAFERNET_TOKEN: string;
};

const isValidRequest = async (context: Context<EnvVars>, event: Body) => {
  const { ACCOUNT_SID, AUTH_TOKEN, SAVE_PENDING_CONTACTS_STATIC_KEY } = context;
  const { Token, ApiKey } = event;

  if (Token) {
    try {
      await validateToken(Token, ACCOUNT_SID, AUTH_TOKEN);
      return true;
    } catch (err) {
      return false;
    }
  } else if (ApiKey) {
    return ApiKey === SAVE_PENDING_CONTACTS_STATIC_KEY;
  }

  return false;
};

export const handler: ServerlessFunctionSignature<EnvVars, Body> = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  const { SAFERNET_ENDPOINT, SAFERNET_TOKEN, SAVE_PENDING_CONTACTS_STATIC_KEY } = context;

  if (!SAFERNET_ENDPOINT) throw new Error('SAFERNET_ENDPOINT env var not provided.');
  if (!SAFERNET_TOKEN) throw new Error('SAFERNET_TOKEN env var not provided.');
  if (!SAVE_PENDING_CONTACTS_STATIC_KEY)
    throw new Error('SAVE_PENDING_CONTACTS_STATIC_KEY env var not provided.');

  const isValid = await isValidRequest(context, event);

  if (!isValid) {
    resolve(error403('No AccessToken or ApiKey was found'));
    return;
  }

  try {
    const { payload } = event;

    const signedPayload = crypto
      .createHmac('sha256', SAFERNET_TOKEN)
      .update(encodeURIComponent(payload))
      .digest('hex');

    const saferNetResponse = await axios({
      url: SAFERNET_ENDPOINT,
      method: 'POST',
      data: JSON.parse(payload),
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': `sha256=${signedPayload}`,
      },
    });

    if (saferNetResponse.data.success) {
      resolve(success(saferNetResponse.data.post_survey_link));
    } else {
      const errorMessage = saferNetResponse.data.error_message;

      // eslint-disable-next-line no-console
      console.warn(errorMessage);
      resolve(error500(new Error(errorMessage)));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(err);
    resolve(error500(err));
  }
};

export type SaveContact = typeof handler;
