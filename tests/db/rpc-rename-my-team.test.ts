// t311: an owner renames their own team; admins and other members get no bypass.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, rpc } from './helpers';
import { auctionFixture, member, type AuctionFixture } from './auction-fixture';

let f: AuctionFixture;
let alice: string, aliceM: string, bob: string, bobM: string;

const rename = (mid: string, name: string, who: string) =>
  as(f.db, who, (tx) => rpc(tx, 'rename_my_team', { p_membership: mid, p_name: name }));
const teamName = async (mid: string) =>
  (await f.db.query<{ team_name: string }>('select team_name from public.memberships where id = $1', [mid])).rows[0].team_name;
const audit = async () => (await f.db.query<{ actor: string; entity_id: string; details: Record<string, unknown> }>(
  `select actor, entity_id, details from public.audit_log where action = 'rename_my_team' order by id`)).rows;

beforeEach(async () => {
  f = await auctionFixture(2);
  [alice, aliceM] = await member(f.db, 'alice');
  [bob, bobM] = await member(f.db, 'bob');
});

describe('rename_my_team', () => {
  it('renames your own team, trimmed, and logs old and new', async () => {
    await rename(aliceM, '  Gimp Zeal ', alice);
    expect(await teamName(aliceM)).toBe('Gimp Zeal');
    expect((await audit())[0]).toMatchObject({ actor: alice, entity_id: aliceM, details: { old: 'alice', new: 'Gimp Zeal' } });
  });

  it('refuses bad names and a sibling name; its own name is fine', async () => {
    await expect(rename(aliceM, '', alice)).rejects.toThrow('INVALID_TEAM_NAME');
    await expect(rename(aliceM, '   ', alice)).rejects.toThrow('INVALID_TEAM_NAME');
    await expect(rename(aliceM, 'x'.repeat(41), alice)).rejects.toThrow('INVALID_TEAM_NAME');
    await expect(rename(aliceM, 'bob', alice)).rejects.toThrow('TEAM_NAME_TAKEN');
    await rename(aliceM, 'alice', alice);
  });

  it("refuses someone else's team, an unknown id and a removed team, admins included", async () => {
    await expect(rename(bobM, 'Zed', alice)).rejects.toThrow('NOT_MEMBER');
    await expect(rename(bobM, 'Zed', f.admin)).rejects.toThrow('NOT_MEMBER');
    await expect(rename(crypto.randomUUID(), 'Zed', alice)).rejects.toThrow('NOT_MEMBER');
    // A removed team (removed_at set; the owner link may still be there) is frozen for its old owner.
    await f.db.query('update public.memberships set removed_at = now() where id = $1', [bobM]);
    await expect(rename(bobM, 'Zed', bob)).rejects.toThrow('NOT_MEMBER');
    // Same after admin_remove_user nulls the owner link.
    await f.db.query('update public.memberships set user_id = null where id = $1', [bobM]);
    await expect(rename(bobM, 'Zed', bob)).rejects.toThrow('NOT_MEMBER');
    expect(await teamName(bobM)).toBe('bob');
    expect(await audit()).toEqual([]);
  });

  it('is not callable by anon', async () => {
    expect((await f.db.query(`select has_function_privilege('anon', 'public.rename_my_team(uuid, text)', 'execute') as ok`)).rows[0])
      .toEqual({ ok: false });
  });
});
