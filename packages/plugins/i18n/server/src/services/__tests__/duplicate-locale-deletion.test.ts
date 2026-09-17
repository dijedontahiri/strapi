import type { Core } from '@strapi/types';
import { emitAudit } from '@strapi/utils';
import localesServiceFactory from '../locales';

jest.mock('@strapi/utils', () => ({ emitAudit: jest.fn() }));

const locale = { id: 42, code: 'fr', name: 'French' };
const localeUID = 'plugin::i18n.locale';
const articleUID = 'api::article.article';
const pageUID = 'api::page.page';
const sharedUID = 'api::shared.shared';

const findOne = jest.fn();
const deleteLocale = jest.fn();
const deleteArticles = jest.fn();
const deletePages = jest.fn();
const sendMetrics = jest.fn();
const query = jest.fn();
const service = localesServiceFactory();

describe('deleting duplicate locale configuration rows', () => {
  const originalStrapi = global.strapi;

  beforeEach(() => {
    jest.resetAllMocks();
    findOne.mockResolvedValueOnce(locale).mockResolvedValue(null);
    deleteLocale.mockResolvedValue(locale);
    deleteArticles.mockResolvedValue({ count: 1 });
    deletePages.mockResolvedValue({ count: 1 });
    query.mockImplementation((uid: string) => {
      if (uid === localeUID) return { findOne, delete: deleteLocale };
      if (uid === articleUID) return { deleteMany: deleteArticles };
      if (uid === pageUID) return { deleteMany: deletePages };
      throw new Error(`Unexpected content query: ${uid}`);
    });

    const services = {
      metrics: { sendDidUpdateI18nLocalesEvent: sendMetrics },
      'content-types': {
        isLocalizedContentType: (model: { uid: string }) => model.uid !== sharedUID,
      },
    };

    global.strapi = {
      db: { query },
      plugin: () => ({ service: (name: keyof typeof services) => services[name] }),
      contentTypes: {
        [articleUID]: { uid: articleUID },
        [pageUID]: { uid: pageUID },
        [sharedUID]: { uid: sharedUID },
      },
    } as unknown as Core.Strapi;
  });

  afterEach(() => {
    global.strapi = originalStrapi;
  });

  test('preserves entries when another definition has the same code', async () => {
    findOne.mockReset().mockResolvedValueOnce(locale).mockResolvedValueOnce({ id: 43 });

    await expect(service.delete({ id: 42 })).resolves.toEqual(locale);

    expect(findOne).toHaveBeenLastCalledWith({
      select: ['id'],
      where: { code: 'fr', id: { $ne: 42 } },
    });
    expect(deleteLocale).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(deleteArticles).not.toHaveBeenCalled();
    expect(deletePages).not.toHaveBeenCalled();
    expect(sendMetrics).toHaveBeenCalledTimes(1);
    expect(emitAudit).toHaveBeenCalledWith({ strapi: global.strapi }, 'locale.delete', {
      localeId: 42,
      code: 'fr',
      name: 'French',
    });
  });

  test('deletes localized entries when the removed row is the only definition', async () => {
    await expect(service.delete({ id: 42 })).resolves.toEqual(locale);

    expect(deleteArticles).toHaveBeenCalledWith({ where: { locale: 'fr' } });
    expect(deletePages).toHaveBeenCalledWith({ where: { locale: 'fr' } });
    expect(query).not.toHaveBeenCalledWith(sharedUID);
    expect(deleteLocale).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(sendMetrics).toHaveBeenCalledTimes(1);
    expect(emitAudit).toHaveBeenCalledTimes(1);
  });

  test('uses the stored id to exclude the row when the route id is a string', async () => {
    await service.delete({ id: '42' });

    expect(findOne).toHaveBeenNthCalledWith(1, { where: { id: '42' } });
    expect(findOne).toHaveBeenNthCalledWith(2, {
      select: ['id'],
      where: { code: 'fr', id: { $ne: 42 } },
    });
    expect(deleteLocale).toHaveBeenCalledWith({ where: { id: '42' } });
    expect(deleteArticles).toHaveBeenCalledTimes(1);
  });

  test('does nothing when the requested locale is missing', async () => {
    findOne.mockReset().mockResolvedValue(null);

    await expect(service.delete({ id: 42 })).resolves.toBeNull();

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(deleteLocale).not.toHaveBeenCalled();
    expect(deleteArticles).not.toHaveBeenCalled();
    expect(deletePages).not.toHaveBeenCalled();
    expect(sendMetrics).not.toHaveBeenCalled();
    expect(emitAudit).not.toHaveBeenCalled();
  });

  test('does not delete anything if checking for another definition fails', async () => {
    const error = new Error('locale lookup failed');
    findOne.mockReset().mockResolvedValueOnce(locale).mockRejectedValueOnce(error);

    await expect(service.delete({ id: 42 })).rejects.toBe(error);

    expect(deleteLocale).not.toHaveBeenCalled();
    expect(deleteArticles).not.toHaveBeenCalled();
    expect(deletePages).not.toHaveBeenCalled();
    expect(sendMetrics).not.toHaveBeenCalled();
    expect(emitAudit).not.toHaveBeenCalled();
  });

  test('does not report success when deleting the redundant row fails', async () => {
    const error = new Error('locale deletion failed');
    findOne.mockReset().mockResolvedValueOnce(locale).mockResolvedValueOnce({ id: 43 });
    deleteLocale.mockRejectedValue(error);

    await expect(service.delete({ id: 42 })).rejects.toBe(error);

    expect(deleteArticles).not.toHaveBeenCalled();
    expect(deletePages).not.toHaveBeenCalled();
    expect(sendMetrics).not.toHaveBeenCalled();
    expect(emitAudit).not.toHaveBeenCalled();
  });

  test('keeps the last locale row if deleting its content fails', async () => {
    const error = new Error('content deletion failed');
    deleteArticles.mockRejectedValue(error);

    await expect(service.delete({ id: 42 })).rejects.toBe(error);

    expect(deleteLocale).not.toHaveBeenCalled();
    expect(sendMetrics).not.toHaveBeenCalled();
    expect(emitAudit).not.toHaveBeenCalled();
  });
});
