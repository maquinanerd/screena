import * as migration_20260728_224559_initial from './20260728_224559_initial';
import * as migration_20260729_011649_outbox_lease_and_scopes from './20260729_011649_outbox_lease_and_scopes';

export const migrations = [
  {
    up: migration_20260728_224559_initial.up,
    down: migration_20260728_224559_initial.down,
    name: '20260728_224559_initial',
  },
  {
    up: migration_20260729_011649_outbox_lease_and_scopes.up,
    down: migration_20260729_011649_outbox_lease_and_scopes.down,
    name: '20260729_011649_outbox_lease_and_scopes'
  },
];
