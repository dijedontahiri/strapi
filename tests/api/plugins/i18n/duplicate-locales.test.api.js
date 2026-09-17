'use strict';

const { createTestBuilder } = require('api-tests/builder');
const { createStrapiInstance } = require('api-tests/strapi');
const { createAuthRequest } = require('api-tests/request');

const localeUID = 'plugin::i18n.locale';
const articleUID = 'api::locale-article.locale-article';
const recordUID = 'api::locale-record.locale-record';
const contentUIDs = [articleUID, recordUID];

const model = (name, draftAndPublish) => ({
  displayName: name,
  singularName: name,
  pluralName: `${name}s`,
  draftAndPublish,
  pluginOptions: { i18n: { localized: true } },
  attributes: { title: { type: 'string' } },
});

describe('duplicate locale deletion preserves content by code', () => {
  const builder = createTestBuilder();
  let strapi;
  let rq;
  let localeService;
  let originalEnglishLocaleId;

  const readContent = () =>
    Promise.all(contentUIDs.map((uid) => strapi.db.query(uid).findMany({ orderBy: { id: 'asc' } })));

  const clean = async () => {
    for (const uid of contentUIDs) {
      await strapi.db.query(uid).deleteMany({});
    }
    await strapi.db.query(localeUID).deleteMany({
      where: { id: { $ne: originalEnglishLocaleId } },
    });
  };

  const createLocale = (code, name = 'French') =>
    strapi.db.query(localeUID).create({ data: { code, name } });

  const seedContent = async () => {
    for (const uid of contentUIDs) {
      for (const locale of ['fr', 'fr-CA', 'en']) {
        await strapi.documents(uid).create({
          locale,
          status: 'published',
          data: { title: `${uid} ${locale}` },
        });
      }
    }
  };

  beforeAll(async () => {
    await builder
      .addContentType(model('locale-article', true))
      .addContentType(model('locale-record', false))
      .build();
    strapi = await createStrapiInstance();
    rq = await createAuthRequest({ strapi });
    localeService = strapi.plugin('i18n').service('locales');
    const english = await localeService.findByCode('en');
    originalEnglishLocaleId = english.id;
    await localeService.setDefaultLocale({ code: 'en' });
    expect(strapi.contentTypes[articleUID].options.draftAndPublish).toBe(true);
    expect(strapi.contentTypes[recordUID].options.draftAndPublish).toBe(false);
  });

  beforeEach(async () => {
    await clean();
    await createLocale('fr-CA');
  });

  afterEach(async () => {
    await clean();
  });

  afterAll(async () => {
    await strapi.destroy();
    await builder.cleanup();
  });

  // Direct query-engine inserts recreate the inconsistent configuration from #27656.
  // The public create-locale endpoint correctly rejects duplicate codes.
  test.each([0, 1])('deleting duplicate row %i keeps every content row unchanged', async (index) => {
    const locales = [await createLocale('fr'), await createLocale('fr')];
    await seedContent();
    const before = await readContent();
    const frenchArticles = before[0].filter((entry) => entry.locale === 'fr');
    expect(frenchArticles).toHaveLength(2);
    expect(frenchArticles.filter((entry) => entry.publishedAt === null)).toHaveLength(1);
    expect(before[1].filter((entry) => entry.locale === 'fr')).toHaveLength(1);

    const res = await rq({ url: `/i18n/locales/${locales[index].id}`, method: 'DELETE' });

    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(locales[index].id);
    expect(await localeService.find({ code: 'fr' })).toEqual([locales[1 - index]]);
    expect(await readContent()).toEqual(before);
  });

  test('only deleting the final definition removes the content for that exact code', async () => {
    const locales = [await createLocale('fr'), await createLocale('fr'), await createLocale('fr')];
    await seedContent();
    const before = await readContent();

    for (const locale of locales.slice(0, 2)) {
      const res = await rq({ url: `/i18n/locales/${locale.id}`, method: 'DELETE' });
      expect(res.statusCode).toBe(200);
      expect(await readContent()).toEqual(before);
    }

    const res = await rq({ url: `/i18n/locales/${locales[2].id}`, method: 'DELETE' });
    expect(res.statusCode).toBe(200);
    expect(await localeService.find({ code: 'fr' })).toEqual([]);
    expect(await readContent()).toEqual(
      before.map((entries) => entries.filter((entry) => entry.locale !== 'fr'))
    );
  });

  test('a different locale with the same display name is not a duplicate code', async () => {
    const french = await createLocale('fr');
    await seedContent();
    const before = await readContent();

    const res = await rq({ url: `/i18n/locales/${french.id}`, method: 'DELETE' });

    expect(res.statusCode).toBe(200);
    expect(await readContent()).toEqual(
      before.map((entries) => entries.filter((entry) => entry.locale !== 'fr'))
    );
    expect(await localeService.find({ code: 'fr-CA' })).toHaveLength(1);
  });

  test('the default-locale deletion protection still applies to duplicate rows', async () => {
    await createLocale('fr');
    const duplicateEnglish = await createLocale('en', 'English');
    await seedContent();
    const before = await readContent();

    const res = await rq({ url: `/i18n/locales/${duplicateEnglish.id}`, method: 'DELETE' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toBe('Cannot delete the default locale');
    expect(await localeService.find({ code: 'en' })).toHaveLength(2);
    expect(await readContent()).toEqual(before);
  });
});
