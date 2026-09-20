import { getNewStateFromChangedValues } from './ConditionsModal';

describe('getNewStateFromChangedValues', () => {
  test('keeps condition state in its category bucket', () => {
    const options = [
      ['default', [{ id: 'admin::is-creator' }]],
      ['My Category', [{ id: 'admin::my-condition' }]],
    ] as unknown as Parameters<typeof getNewStateFromChangedValues>[0];

    expect(getNewStateFromChangedValues(options, ['admin::my-condition'])).toEqual({
      default: {
        'admin::is-creator': false,
      },
      'My Category': {
        'admin::my-condition': true,
      },
    });
  });
});
