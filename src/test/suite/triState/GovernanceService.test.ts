import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import GovernanceService, { getDefaultRulesPath } from '../../../services/triState/GovernanceService';

describe('GovernanceService', () => {
  it('creates default rules if missing', async () => {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-rules-'));
    const service = new GovernanceService(workspaceRoot);

    const rules = await service.loadRules();

    const rulesPath = getDefaultRulesPath(workspaceRoot);
    expect(fs.existsSync(rulesPath)).toBe(true);
    expect(rules.schema_version).toBe(1);
    expect(rules.rules.length).toBeGreaterThan(0);
  });
});
