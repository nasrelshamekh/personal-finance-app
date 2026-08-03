import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../prisma';

/**
 * HTTP contract for the Phase 3 routers — status codes, validation shapes and the
 * archive-instead-of-delete rule end to end. Semantics live in the service tests.
 *
 * These run against the real database rather than a transaction, so everything created is
 * tracked and removed afterwards.
 */
const app = createApp({ corsOrigins: ['http://localhost:5173'], requestLogging: false });

const createdAccountIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdTransactionIds: string[] = [];

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
  await prisma.transaction.deleteMany({ where: { accountId: { in: createdAccountIds } } });
  await prisma.account.deleteMany({ where: { id: { in: createdAccountIds } } });
  await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  await prisma.$disconnect();
});

async function newAccount(name: string, currency: 'EGP' | 'USD', openingBalance = '0') {
  const res = await request(app)
    .post('/api/accounts')
    .send({ name, type: 'CASH', currency, openingBalance, color: '#2f8f5b', icon: 'wallet' });

  expect(res.status).toBe(201);
  createdAccountIds.push(res.body.id);
  return res.body as { id: string; balance: string; balanceEgp: string };
}

describe('accounts', () => {
  it('creates, lists and fetches', async () => {
    const account = await newAccount('HTTP cash', 'EGP', '1500');

    expect(account.balance).toBe('1500.0000');

    const list = await request(app).get('/api/accounts');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);

    const one = await request(app).get(`/api/accounts/${account.id}`);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(account.id);
  });

  it('rejects a bad colour with a field-level message', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .send({ name: 'x', type: 'CASH', currency: 'EGP', color: 'green', icon: 'wallet' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'color' })]),
    );
  });

  it('404s an unknown id and 400s a malformed one', async () => {
    expect(
      (await request(app).get('/api/accounts/00000000-0000-0000-0000-000000000000')).status,
    ).toBe(404);
    expect((await request(app).get('/api/accounts/not-a-uuid')).status).toBe(400);
  });
});

describe('categories', () => {
  it('creates and returns a tree', async () => {
    const parent = await request(app)
      .post('/api/categories')
      .send({ name: 'HTTP food', kind: 'EXPENSE', color: '#8f7a3f', icon: 'basket' });
    expect(parent.status).toBe(201);
    createdCategoryIds.push(parent.body.id);

    const child = await request(app).post('/api/categories').send({
      name: 'HTTP groceries',
      kind: 'EXPENSE',
      color: '#8f7a3f',
      icon: 'apple',
      parentId: parent.body.id,
    });
    expect(child.status).toBe(201);
    createdCategoryIds.push(child.body.id);

    const tree = await request(app).get('/api/categories');
    const found = tree.body.data.find((node: { id: string }) => node.id === parent.body.id) as
      { children: Array<{ id: string }> } | undefined;

    expect(found?.children.map((c) => c.id)).toContain(child.body.id);
  });
});

describe('transactions', () => {
  it('creates an income and returns it signed', async () => {
    const account = await newAccount('HTTP income acct', 'EGP');

    const res = await request(app).post('/api/transactions').send({
      type: 'INCOME',
      amount: '2500',
      accountId: account.id,
      date: '2026-08-03',
    });

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe('2500.0000');
    createdTransactionIds.push(res.body.id);
  });

  it('creates a transfer pair and reports the group', async () => {
    const from = await newAccount('HTTP transfer from', 'EGP', '5000');
    const to = await newAccount('HTTP transfer to', 'EGP');

    const res = await request(app).post('/api/transactions').send({
      type: 'TRANSFER',
      fromAccountId: from.id,
      toAccountId: to.id,
      fromAmount: '1000',
      date: '2026-08-03',
    });

    expect(res.status).toBe(201);
    expect(res.body.from.amount).toBe('-1000.0000');
    expect(res.body.to.amount).toBe('1000.0000');
    createdTransactionIds.push(res.body.from.id, res.body.to.id);

    const fromAfter = await request(app).get(`/api/accounts/${from.id}`);
    const toAfter = await request(app).get(`/api/accounts/${to.id}`);
    expect(fromAfter.body.balance).toBe('4000.0000');
    expect(toAfter.body.balance).toBe('1000.0000');
  });

  it('paginates with the documented meta shape', async () => {
    const res = await request(app).get('/api/transactions').query({ page: 1, pageSize: 5 });

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5 });
    expect(typeof res.body.meta.total).toBe('number');
    expect(typeof res.body.meta.totalPages).toBe('number');
  });

  it('rejects an amount that is not valid arithmetic', async () => {
    const account = await newAccount('HTTP bad amount', 'EGP');

    const res = await request(app)
      .post('/api/transactions')
      .send({ type: 'EXPENSE', amount: '100*', accountId: account.id, date: '2026-08-03' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toMatchObject({ field: 'amount' });
  });

  it('rejects a currency that does not match the account (D3)', async () => {
    const account = await newAccount('HTTP currency clash', 'EGP');

    const res = await request(app).post('/api/transactions').send({
      type: 'EXPENSE',
      amount: '100',
      currency: 'USD',
      accountId: account.id,
      date: '2026-08-03',
    });

    expect(res.status).toBe(422);
    expect(res.body.error.details).toMatchObject({ field: 'currency' });
  });
});

describe('archive instead of delete', () => {
  it('archives an account that holds transactions, and deletes an empty one', async () => {
    const used = await newAccount('HTTP used', 'EGP');
    const unused = await newAccount('HTTP unused', 'EGP');

    const tx = await request(app)
      .post('/api/transactions')
      .send({ type: 'EXPENSE', amount: '50', accountId: used.id, date: '2026-08-03' });
    createdTransactionIds.push(tx.body.id);

    const archived = await request(app).delete(`/api/accounts/${used.id}`);
    expect(archived.status).toBe(200);
    expect(archived.body.outcome).toBe('archived');
    expect(archived.body.account.isArchived).toBe(true);

    const deleted = await request(app).delete(`/api/accounts/${unused.id}`);
    expect(deleted.body.outcome).toBe('deleted');

    // The archived account is still fetchable; the deleted one is not.
    expect((await request(app).get(`/api/accounts/${used.id}`)).status).toBe(200);
    expect((await request(app).get(`/api/accounts/${unused.id}`)).status).toBe(404);
  });
});

describe('settings', () => {
  it('reads settings and refuses to change the base currency', async () => {
    const read = await request(app).get('/api/settings');
    expect(read.status).toBe(200);
    expect(read.body.baseCurrencyLocked).toBe(true);

    const write = await request(app).put('/api/settings').send({ baseCurrency: 'USD' });
    expect(write.status).toBe(422);
    expect(write.body.error.details).toMatchObject({ field: 'baseCurrency' });
  });
});

describe('dashboard', () => {
  it('answers with everything the dashboard needs, in one call', async () => {
    const res = await request(app).get('/api/dashboard').query({ month: '2026-08' });

    expect(res.status).toBe(200);
    expect(res.body.month).toBe('2026-08');
    for (const key of [
      'netWorth',
      'totals',
      'spendByCategory',
      'daily',
      'recentTransactions',
      'accounts',
      'debtsDueSoon',
      'savingsGoals',
      'rates',
    ]) {
      expect(res.body).toHaveProperty(key);
    }
    expect(res.body.daily).toHaveLength(31);
  });

  it('rejects a malformed month', async () => {
    const res = await request(app).get('/api/dashboard').query({ month: 'August' });
    expect(res.status).toBe(400);
  });
});
