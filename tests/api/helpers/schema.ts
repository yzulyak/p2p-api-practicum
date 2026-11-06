import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { APIRequestContext } from '@playwright/test';

let ajvPromise: Promise<Ajv> | undefined;

async function getAjv(request: APIRequestContext): Promise<Ajv> {
  if (!ajvPromise) {
    ajvPromise = (async () => {
      const response = await request.get('/openapi.json');
      if (!response.ok()) {
        throw new Error(`Failed to load /openapi.json: ${response.status()}`);
      }
      const doc: unknown = await response.json();
      const ajv = new Ajv({ strict: false, allErrors: true });
      ajv.addSchema(doc, 'openapi');
      return ajv;
    })();
  }
  return ajvPromise;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return '(no Ajv errors)';
  }
  return errors
    .map((error) => {
      const path = error.instancePath === '' ? '/' : error.instancePath;
      return `${path}: ${error.message ?? 'validation failed'}`;
    })
    .join('\n');
}

export async function expectSchema(
  request: APIRequestContext,
  body: unknown,
  name: string,
): Promise<void> {
  const ajv = await getAjv(request);
  const ref = `openapi#/components/schemas/${name}`;
  const validate: ValidateFunction | undefined = ajv.getSchema(ref);

  if (!validate) {
    throw new Error(`Schema "${name}" not found at ${ref}`);
  }

  const valid = validate(body);
  if (!valid) {
    throw new Error(
      `Response does not match schema "${name}":\n${formatErrors(validate.errors)}`,
    );
  }
}
