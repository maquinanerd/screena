import * as migration_20260728_224559_initial from './20260728_224559_initial';

export const migrations = [
  {
    up: migration_20260728_224559_initial.up,
    down: migration_20260728_224559_initial.down,
    name: '20260728_224559_initial'
  },
];
