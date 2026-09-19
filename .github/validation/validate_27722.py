from pathlib import Path

ROOT = Path.cwd()
SERVICES = ROOT / 'packages/core/content-releases/server/src/services'
TESTS = SERVICES / '__tests__'

RELEASE_STALE_TEST = r'''import createReleaseService from '../release';
import { RELEASE_ACTION_MODEL_UID, RELEASE_MODEL_UID } from '../../constants';

describe('release publish stale validity status', () => {
  const makeStrapi = ({ initialStatus, freshValid }: { initialStatus: string; freshValid: boolean }) => {
    let releaseStatus = initialStatus;
    const publish = jest.fn().mockResolvedValue({});
    const unpublish = jest.fn().mockResolvedValue({});
    const validateActionsByRelease = jest.fn().mockResolvedValue(freshValid);
    const releaseAction = {
      id: 11,
      type: 'publish',
      contentType: 'api::article.article',
      entryDocumentId: 'article-doc',
      locale: 'en',
      isEntryValid: !freshValid,
    };

    const query = jest.fn((uid: string) => {
      if (uid === RELEASE_ACTION_MODEL_UID) {
        return {
          findMany: jest.fn().mockResolvedValue([releaseAction]),
        };
      }
      if (uid === RELEASE_MODEL_UID) {
        return {
          update: jest.fn(({ data }: { data: { status: string; releasedAt?: Date } }) => {
            releaseStatus = data.status;
            return Promise.resolve({
              id: 1,
              name: 'September',
              status: releaseStatus,
              releasedAt: data.releasedAt ?? null,
            });
          }),
        };
      }
      throw new Error(`Unexpected query ${uid}`);
    });

    const queryBuilder = jest.fn(() => {
      let nextStatus: string | null = null;
      const builder: any = {
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        first: jest.fn().mockReturnThis(),
        transacting: jest.fn().mockReturnThis(),
        forUpdate: jest.fn().mockReturnThis(),
        update: jest.fn(({ status }: { status: string }) => {
          nextStatus = status;
          return builder;
        }),
        execute: jest.fn().mockImplementation(() => {
          if (nextStatus) releaseStatus = nextStatus;
          return Promise.resolve({
            id: 1,
            name: 'September',
            releasedAt: null,
            status: releaseStatus,
          });
        }),
      };
      return builder;
    });

    const strapi: any = {
      db: {
        query,
        queryBuilder,
        transaction: jest.fn(async (callback: any) => callback({ trx: {} })),
      },
      documents: jest.fn(() => ({ publish, unpublish })),
      contentTypes: { 'api::article.article': {} },
      getModel: jest.fn(() => ({
        options: { draftAndPublish: true },
        attributes: {},
      })),
      plugin: jest.fn((pluginName: string) => ({
        service: jest.fn((serviceName: string) => {
          if (pluginName === 'content-releases' && serviceName === 'release-action') {
            return {
              validateActionsByRelease,
              countActions: jest.fn(({ filters }: { filters: { type?: string } }) =>
                Promise.resolve(filters.type === 'unpublish' ? 0 : 1)
              ),
            };
          }
          return {};
        }),
      })),
      eventHub: { emit: jest.fn() },
      telemetry: { send: jest.fn() },
      log: { info: jest.fn(), error: jest.fn() },
    };

    return {
      strapi,
      publish,
      validateActionsByRelease,
      getReleaseStatus: () => releaseStatus,
    };
  };

  it('revalidates a stale blocked release and publishes after the entry becomes valid', async () => {
    const fixture = makeStrapi({ initialStatus: 'blocked', freshValid: true });
    const service = createReleaseService({ strapi: fixture.strapi });

    await service.publish(1);

    expect(fixture.validateActionsByRelease).toHaveBeenCalledWith(1);
    expect(fixture.publish).toHaveBeenCalledWith({ documentId: 'article-doc', locale: 'en' });
    expect(fixture.getReleaseStatus()).toBe('done');
  });

  it('blocks a stale ready release when fresh validation fails', async () => {
    const fixture = makeStrapi({ initialStatus: 'ready', freshValid: false });
    const service = createReleaseService({ strapi: fixture.strapi });

    await expect(service.publish(1)).rejects.toThrow('Release has invalid entries');

    expect(fixture.validateActionsByRelease).toHaveBeenCalledWith(1);
    expect(fixture.publish).not.toHaveBeenCalled();
    expect(fixture.getReleaseStatus()).toBe('blocked');
  });
});
'''

RELEASE_ACTION_REVALIDATION_TEST = r'''import createReleaseActionService from '../release-action';
import { RELEASE_ACTION_MODEL_UID } from '../../constants';

const mockGetDraftEntryValidStatus = jest.fn();

jest.mock('../../utils', () => ({
  ...jest.requireActual('../../utils'),
  getDraftEntryValidStatus: (...args: unknown[]) => mockGetDraftEntryValidStatus(...args),
}));

describe('release action revalidation by release', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refreshes publish action validity and returns whether every action is valid', async () => {
    const actions = [
      {
        id: 1,
        type: 'publish',
        contentType: 'api::article.article',
        entryDocumentId: 'valid-doc',
        locale: 'en',
        isEntryValid: false,
      },
      {
        id: 2,
        type: 'publish',
        contentType: 'api::article.article',
        entryDocumentId: 'invalid-doc',
        locale: 'en',
        isEntryValid: true,
      },
    ];
    const update = jest.fn().mockResolvedValue({});
    const findMany = jest.fn().mockResolvedValue(actions);
    const strapi: any = {
      db: {
        query: jest.fn((uid: string) => {
          if (uid !== RELEASE_ACTION_MODEL_UID) throw new Error(`Unexpected query ${uid}`);
          return { findMany, update };
        }),
      },
    };

    mockGetDraftEntryValidStatus.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const service = createReleaseActionService({ strapi });
    const isValid = await service.validateActionsByRelease(42);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        type: 'publish',
        release: {
          id: 42,
          releasedAt: { $null: true },
        },
      },
    });
    expect(mockGetDraftEntryValidStatus).toHaveBeenNthCalledWith(
      1,
      {
        contentType: 'api::article.article',
        documentId: 'valid-doc',
        locale: 'en',
      },
      { strapi }
    );
    expect(mockGetDraftEntryValidStatus).toHaveBeenNthCalledWith(
      2,
      {
        contentType: 'api::article.article',
        documentId: 'invalid-doc',
        locale: 'en',
      },
      { strapi }
    );
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: 1 },
      data: { isEntryValid: true },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 2 },
      data: { isEntryValid: false },
    });
    expect(isValid).toBe(false);
  });
});
'''


def write_tests() -> None:
    (TESTS / 'release-stale-status.test.ts').write_text(RELEASE_STALE_TEST)
    (TESTS / 'release-action-revalidation.test.ts').write_text(RELEASE_ACTION_REVALIDATION_TEST)


def apply_candidate() -> None:
    release_path = SERVICES / 'release.ts'
    release = release_path.read_text()
    failed_guard = "        if (lockedRelease.status === 'failed') {\n          throw new errors.ValidationError('Release failed to publish');\n        }"
    validation = failed_guard + r'''

        const releaseActionService = getService('release-action', { strapi });
        const areActionsValid = await releaseActionService.validateActionsByRelease(releaseId);

        if (!areActionsValid) {
          await strapi.db
            ?.queryBuilder(RELEASE_MODEL_UID)
            .where({ id: releaseId })
            .update({ status: 'blocked' })
            .transacting(trx)
            .execute();

          throw new errors.ValidationError('Release has invalid entries');
        }'''
    assert failed_guard in release
    release_path.write_text(release.replace(failed_guard, validation, 1))

    action_path = SERVICES / 'release-action.ts'
    action = action_path.read_text()
    marker = "    async validateActionsByContentTypes(contentTypeUids: UID.ContentType[]) {"
    method = r'''    async validateActionsByRelease(releaseId: Data.ID) {
      const actions = (await strapi.db.query(RELEASE_ACTION_MODEL_UID).findMany({
        where: {
          type: 'publish',
          release: {
            id: releaseId,
            releasedAt: {
              $null: true,
            },
          },
        },
      })) as ReleaseAction[];

      const validationResults = await async.map(actions, async (action: ReleaseAction) => {
        const isValid = await getDraftEntryValidStatus(
          {
            contentType: action.contentType,
            documentId: action.entryDocumentId,
            locale: action.locale,
          },
          { strapi }
        );

        if (action.isEntryValid !== isValid) {
          await strapi.db.query(RELEASE_ACTION_MODEL_UID).update({
            where: {
              id: action.id,
            },
            data: {
              isEntryValid: isValid,
            },
          });
        }

        return isValid;
      });

      return validationResults.every(Boolean);
    },

'''
    assert marker in action
    action_path.write_text(action.replace(marker, method + marker, 1))

    test_path = TESTS / 'release.test.ts'
    test = test_path.read_text()
    count_line = "      countActions: jest.fn(),"
    replacement = count_line + "\n      validateActionsByRelease: jest.fn().mockResolvedValue(true),"
    assert count_line in test
    test_path.write_text(test.replace(count_line, replacement, 1))


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['tests', 'candidate'])
    args = parser.parse_args()

    write_tests()
    if args.mode == 'candidate':
        apply_candidate()
