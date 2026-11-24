import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const GROUPS = ['src/app/(ops)', 'src/app/(portal)', 'src/app/(admin)'];
const BOUNDARY = '@/server/data/durable-records';
const AI_ROUTES = [
  ['src/app/api/estate/copilot/route.ts', 'estate'],
  ['src/app/api/copilot/route.ts', 'facility'],
  ['src/app/api/shortlet/copilot/route.ts', 'shortlet'],
  ['src/app/api/construction/copilot/route.ts', 'construction'],
] as const;

function files(directory: string): string[] {
  return readdirSync(resolve(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

function source(file: string) {
  return ts.createSourceFile(file, readFileSync(resolve(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

const asyncFunction = (node: ts.Node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
  && Boolean(node.body) && Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword));
const directive = (node: ts.Statement): node is ts.ExpressionStatement & { expression: ts.StringLiteral } =>
  ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression);

/** The body itself is protected: wrapping returned JSX does not execute its server children. */
function expectReadBoundary(file: string, fn: ts.FunctionDeclaration) {
  const ast = source(file);
  const imported = ast.statements.some((node) => ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === BOUNDARY
    && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some((binding) => binding.name.text === 'withDurableRead' && !binding.propertyName));
  expect(imported, file + ' must import the actual read boundary').toBe(true);
  const statements = fn.body!.statements.filter((statement) => !directive(statement));
  expect(statements, file + ' must not read or authenticate outside its boundary').toHaveLength(1);
  const statement = statements[0];
  expect(ts.isReturnStatement(statement)).toBe(true);
  if (!ts.isReturnStatement(statement) || !statement.expression || !ts.isCallExpression(statement.expression)) {
    throw new Error(file + ' must return its read boundary.');
  }
  expect(statement.expression.expression.getText(ast)).toBe('withDurableRead');
  expect(statement.expression.arguments).toHaveLength(1);
  const callback = statement.expression.arguments[0];
  expect(ts.isArrowFunction(callback) && ts.isBlock(callback.body)
    && callback.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)).toBe(true);
}

const pages = GROUPS.flatMap(files).filter((file) => /[\\/](?:page|layout)\.tsx$/.test(file));
const declarations = pages.flatMap((file) => source(file).statements.filter((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)))
  .map((fn) => ({ file, fn })));
const authenticated = declarations.filter(({ fn }) => asyncFunction(fn));
const delegates = declarations.filter(({ fn }) => !asyncFunction(fn));

describe('durable authenticated read entrypoints', () => {
  it('covers every authenticated page, including portal/admin and dynamic detail routes', () => {
    expect(authenticated).toHaveLength(127);
    expect(authenticated.filter(({ file }) => file.startsWith(GROUPS[0]))).toHaveLength(103);
    expect(authenticated.filter(({ file }) => file.startsWith(GROUPS[1]))).toHaveLength(16);
    expect(authenticated.filter(({ file }) => file.startsWith(GROUPS[2]))).toHaveLength(8);
    expect(authenticated.map(({ file }) => file)).toContain('src/app/(ops)/(estate)/estate/work-orders/[ref]/page.tsx');
    expect(authenticated.map(({ file }) => file)).toContain('src/app/(ops)/(facility)/work-orders/[ref]/page.tsx');
  });

  it.each(authenticated)('hydrates before all page body work: $file', ({ file, fn }) => {
    expectReadBoundary(file, fn);
  });

  it('leaves only pure JSX/children layout delegates outside a boundary', () => {
    expect(delegates).toHaveLength(7);
    for (const { file, fn } of delegates) {
      expect(file.endsWith('/layout.tsx')).toBe(true);
      expect(fn.body?.statements).toHaveLength(1);
      const returned = fn.body!.statements[0];
      expect(ts.isReturnStatement(returned)).toBe(true);
      const imports = source(file).statements.filter(ts.isImportDeclaration).map((node) => node.moduleSpecifier.getText());
      const allowed = file === 'src/app/(ops)/construction/layout.tsx'
        ? ["'@/components/shell-frame'", "'@/components/construction/construction-ui'", "'@/server/operating-clock'"]
        : ["'@/components/shell-frame'"];
      expect(imports.every((specifier) => allowed.includes(specifier))).toBe(true);
    }
  });

  it('protects separately rendered async server children instead of relying on ancestor JSX', () => {
    const components = files('src/components').filter((file) => file.endsWith('.tsx')).flatMap((file) => {
      const ast = source(file);
      if (ast.statements.some((node) => directive(node) && node.expression.text === 'use client')) return [];
      const readsServerData = ast.statements.some((node) => ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly
        && ts.isStringLiteral(node.moduleSpecifier)
        && /^@\/server\/(?:data(?:\/|$)|reads\/|session$|workspaces$|facility-guards$|guard$)/.test(node.moduleSpecifier.text)
        && (!node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)
          || node.importClause.namedBindings.elements.some((binding) => !binding.isTypeOnly)));
      if (!readsServerData) return [];
      return ast.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
        && Boolean(node.body) && Boolean(node.name && /^[A-Z]/.test(node.name.text))
        && Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)))
        .map((fn) => ({ file, fn }));
    });
    expect(components.map(({ file }) => relative(resolve(ROOT, 'src/components'), resolve(ROOT, file))).sort())
      .toEqual(['shell-frame.tsx', 'work-orders/work-order-detail-view.tsx', 'workspaces/estate-home.tsx']);
    for (const { file, fn } of components) {
      expect(asyncFunction(fn), file + ' must await its read boundary').toBe(true);
      expectReadBoundary(file, fn);
    }
  });

  it.each(AI_ROUTES)('protects the %s provider entrypoint with a read-only boundary', (file) => {
    const fn = source(file).statements.find((node): node is ts.FunctionDeclaration => asyncFunction(node) && node.name?.text === 'POST');
    expect(fn).toBeDefined();
    expectReadBoundary(file, fn!);
    expect(readFileSync(resolve(ROOT, file), 'utf8')).not.toContain('withDurableMutation');
  });
});

describe('actual Copilot route ordering', () => {
  it.each(AI_ROUTES)('waits for hydration before invoking %s and preserves the response', async (file, module) => {
    const events: string[] = [];
    let active = false;
    const response = new Response('provider response');
    const exports: Record<string, (request: Request) => Promise<Response>> = {};
    const output = ts.transpileModule(readFileSync(resolve(ROOT, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const buildContext = async () => { expect(active).toBe(true); events.push('context'); };
    runInNewContext(output, {
      exports,
      require: (specifier: string) => {
        if (specifier === BOUNDARY) return {
          withDurableRead: async (fn: () => Promise<Response>) => {
            events.push('load');
            await Promise.resolve();
            active = true;
            try { return await fn(); } finally { active = false; events.push('release'); }
          },
        };
        if (specifier === '@/server/ai/copilot') return {
          handleCopilot: async (_request: Request, actual: string, build: () => Promise<void>) => {
            expect(active).toBe(true); expect(actual).toBe(module); events.push('provider handler'); await build(); return response;
          },
        };
        return new Proxy({}, { get: () => buildContext });
      },
    });
    expect(await exports.POST(new Request('https://example.test/copilot', { method: 'POST' }))).toBe(response);
    expect(events).toEqual(['load', 'provider handler', 'context', 'release']);
    expect(active).toBe(false);
  });
});
