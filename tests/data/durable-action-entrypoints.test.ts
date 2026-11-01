import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const directory = resolve(process.cwd(), 'src/server/actions');
const nonOperational = new Set([
  'auth.ts:signOut', 'auth.ts:signInAs', 'dev-identity.ts:switchIdentity',
  'owner-onboarding.ts:saveOwnerSetupAction', 'owner-onboarding.ts:completeOwnerSetupAction',
  'company-auth.ts:registerAccount', 'company-auth.ts:loginAccount', 'company-auth.ts:verifySecondFactor',
  'demo-auth.ts:enterDemoAccount',
  'demo-auth.ts:resetDemoSandbox',
  'demo-auth.ts:switchDemoPersona',
  'companies.ts:createCompany', 'companies.ts:selectCompany', 'companies.ts:createCompanyInvite',
  'companies.ts:updateCompanyMember', 'companies.ts:removeCompanyMember', 'companies.ts:acceptCompanyInvite',
]);
const readOnly = new Set(['ask-data.ts:askData', 'documents.ts:searchDocuments']);
const ownReadState = new Set(['inbox.ts:markNotificationsRead', 'inbox.ts:readThread']);
const explicitAction = new Map([['construction.ts:createRfi', 'create'], ['construction.ts:reviewRfiAnswer', 'approve']]);
const expectedModules: Record<string, readonly string[]> = {
  'admin-users.ts': ['estate', 'facility', 'shortlet', 'construction'],
  'construction-forecast.ts': ['construction'],
  'announcements.ts': ['estate'], 'billing.ts': ['estate'], 'construction.ts': ['construction'], 'construction-control.ts': ['construction'], 'construction-quality.ts': ['construction'], 'construction-change-orders.ts': ['construction'], 'construction-safety.ts': ['construction'],
  'documents.ts': ['estate', 'construction'], 'estate.ts': ['estate'], 'estate-registration.ts': ['estate'],
  'estate-work-orders.ts': ['estate'], 'estate-billing-setup.ts': ['estate'], 'estate-tenancy-setup.ts': ['estate'], 'estate-amenity-setup.ts': ['estate'], 'facility.ts': ['facility'], 'facility-registration.ts': ['facility'],
  'inbox.ts': ['estate', 'facility', 'shortlet', 'construction'], 'inspections.ts': ['facility'],
  'ppm.ts': ['facility'], 'resident-bills.ts': ['estate'], 'resident-bookings.ts': ['estate'],
  'facility-compliance.ts': ['facility'], 'facility-maintenance-setup.ts': ['facility'], 'facility-inventory.ts': ['facility'],
  'facility-site-setup.ts': ['facility'], 'facility-vendors.ts': ['facility'],
  'finance-control.ts': ['estate', 'facility', 'shortlet', 'construction'],
  'resident-community.ts': ['estate'], 'resident-home.ts': ['estate'], 'resident-orders.ts': ['estate'],
  'resident-requests.ts': ['estate'], 'shortlet.ts': ['shortlet'], 'shortlet-control.ts': ['shortlet'], 'sync.ts': ['construction'],
  'transitions.ts': ['estate'], 'vendor-listings.ts': ['estate'], 'work-orders.ts': ['estate', 'facility'],
};
const entries = readdirSync(directory).filter((file) => file.endsWith('.ts')).flatMap((file) => {
  const ast = ts.createSourceFile(file, readFileSync(join(directory, file), 'utf8'), ts.ScriptTarget.Latest, true);
  return ast.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
    && Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)))
    .map((fn) => ({ file, ast, fn, key: file + ':' + fn.name?.text }));
});
const operational = entries.filter(({ key }) => !nonOperational.has(key));

describe('operational action durability coverage', () => {
  it('accounts for all 255 operational actions and the explicit separate account/onboarding actions', () => {
    expect(operational).toHaveLength(255);
    expect(entries.filter(({ key }) => nonOperational.has(key)).map(({ key }) => key).sort()).toEqual([...nonOperational].sort());
    expect(operational.filter(({ key }) => readOnly.has(key))).toHaveLength(2);
    expect(operational.filter(({ key }) => !readOnly.has(key))).toHaveLength(253);
  });

  it.each(operational)('protects the entire authenticated $key body', ({ ast, fn, key, file }) => {
    const expected = readOnly.has(key) ? 'withDurableRead' : 'withDurableMutation';
    expect(fn.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)).toBe(true);
    const body = fn.body!.statements.filter((node) => !(ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression)));
    expect(body, key + ' must not read or mutate before its boundary').toHaveLength(1);
    const returned = body[0];
    if (!ts.isReturnStatement(returned) || !returned.expression || !ts.isCallExpression(returned.expression)) throw new Error(key + ' has no returned durability boundary.');
    expect(returned.expression.expression.getText(ast)).toBe(expected);
    expect(returned.expression.arguments).toHaveLength(readOnly.has(key) ? 1 : ownReadState.has(key) || explicitAction.has(key) ? 3 : 2);
    if (!readOnly.has(key)) {
      const modules = returned.expression.arguments[1];
      const literals = ts.isStringLiteral(modules) ? [modules]
        : ts.isArrayLiteralExpression(modules) ? [...modules.elements] : [];
      expect(literals.length, key + ' must declare at least one server-owned module').toBeGreaterThan(0);
      expect(literals.every(ts.isStringLiteral), key + ' must use static module literals').toBe(true);
      expect(literals.map((node) => (node as ts.StringLiteral).text)).toEqual(expectedModules[file]);
      if (ownReadState.has(key)) expect(returned.expression.arguments[2].getText(ast)).toBe("'read'");
      if (explicitAction.has(key)) expect(returned.expression.arguments[2].getText(ast)).toBe(`'${explicitAction.get(key)}'`);
    }
    const callback = returned.expression.arguments[0];
    expect(ts.isArrowFunction(callback) && ts.isBlock(callback.body)
      && callback.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)).toBe(true);
    const imported = ast.statements.some((node) => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === '@/server/data/durable-records'
      && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
      && node.importClause.namedBindings.elements.some((binding) => binding.name.text === expected && !binding.propertyName));
    expect(imported, key + ' must use the actual server boundary').toBe(true);
  });

  it('does not leave reset-on-restart numeric identity counters at action-module scope', () => {
    for (const file of readdirSync(directory).filter((file) => file.endsWith('.ts'))) {
      const ast = ts.createSourceFile(file, readFileSync(join(directory, file), 'utf8'), ts.ScriptTarget.Latest, true);
      for (const statement of ast.statements.filter(ts.isVariableStatement)) {
        if (statement.declarationList.flags & ts.NodeFlags.Const) continue;
        expect(statement.declarationList.declarations.filter((node) => node.initializer && ts.isNumericLiteral(node.initializer)), file).toHaveLength(0);
      }
    }
  });
});
