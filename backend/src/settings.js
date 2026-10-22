const Joi = require('joi');
const { AdminSetting } = require('./models');

// Typed sections the admin console edits. Unknown sections remain storable
// (generic object payload) so new groups can be added without a migration,
// but only these flow into the public platform settings payload.
const SECTION_SCHEMAS = {
  platform: Joi.object({
    announcementEnabled: Joi.boolean().required(),
    announcementMessage: Joi.string().trim().max(300).allow('').required(),
    supportEmail: Joi.string().trim().email().allow('').max(254).required(),
    supportPhone: Joi.string().trim().pattern(/^[+\d\s()-]{7,20}$/).allow('').required()
  }),
  billing: Joi.object({
    cowRatePaise: Joi.number().integer().min(0).max(1000000).required(),
    buffaloRatePaise: Joi.number().integer().min(0).max(1000000).required(),
    invoiceFooter: Joi.string().trim().max(200).allow('').required()
  }),
  operations: Joi.object({
    registrationOpen: Joi.boolean().required()
  })
};

const SECTION_DEFAULTS = {
  platform: { announcementEnabled: false, announcementMessage: '', supportEmail: '', supportPhone: '' },
  billing: { cowRatePaise: 6000, buffaloRatePaise: 8000, invoiceFooter: '' },
  operations: { registrationOpen: true }
};

const sectionPayload = section => AdminSetting.findOne({ section }).lean()
  .then(doc => {
    const { value, error } = SECTION_SCHEMAS[section].validate(doc && doc.payload, { abortEarly: false, convert: false });
    return { ...SECTION_DEFAULTS[section], ...(error ? {} : value) };
  });

async function platformSettings() {
  const [platform, billing, operations] = await Promise.all([
    sectionPayload('platform'), sectionPayload('billing'), sectionPayload('operations')
  ]);
  return {
    announcement: { enabled: platform.announcementEnabled, message: platform.announcementMessage },
    support: { email: platform.supportEmail, phone: platform.supportPhone },
    defaults: { cowRatePaise: billing.cowRatePaise, buffaloRatePaise: billing.buffaloRatePaise },
    invoice: { footer: billing.invoiceFooter },
    registration: { open: operations.registrationOpen }
  };
}

module.exports = { SECTION_SCHEMAS, SECTION_DEFAULTS, platformSettings };
