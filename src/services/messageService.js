const prisma = require('../config/db');
const { normalizePhoneNumber } = require('./phoneService');
const { logActivity } = require('./activityService');
const { ValidationError, NotFoundError } = require('../utils/errors');

/**
 * Handle incoming WhatsApp message event.
 * Core matching pipeline:
 * WhatsApp sender number -> normalize E.164 -> MongoDB match -> associate contact -> store message
 */
async function processIncomingMessage({ senderPhone, messageText, whatsappMessageId, timestamp = new Date(), defaultCountry = 'PK', messageType = 'text' }) {
  if (!senderPhone || !senderPhone.trim()) {
    throw new ValidationError('Sender phone number is required');
  }

  // De-duplicate message processing if whatsappMessageId is provided
  if (whatsappMessageId) {
    const existingMsg = await prisma.message.findUnique({
      where: { whatsappMessageId },
      include: { contact: { include: { phoneNumbers: true } } },
    });
    if (existingMsg) {
      return { message: existingMsg, matchedContact: existingMsg.contact || null, isDuplicate: true };
    }
  }

  // Normalize sender phone number to E.164 format
  const normResult = normalizePhoneNumber(senderPhone, defaultCountry);
  const normalizedPhone = normResult.isValid ? normResult.normalizedNumber : senderPhone.trim();

  // Search MongoDB by normalized phone number
  let matchedContact = null;
  if (normResult.isValid) {
    const phoneRecord = await prisma.phoneNumber.findUnique({
      where: { normalizedNumber: normResult.normalizedNumber },
      include: { contact: true },
    });
    if (phoneRecord) {
      matchedContact = phoneRecord.contact;
    }
  }

  // Store message in database
  const messageData = {
    senderPhone: senderPhone.trim(),
    normalizedPhone,
    messageText: (messageText || '').trim(),
    messageType: messageType || 'text',
    timestamp: new Date(timestamp),
    direction: 'incoming',
    whatsappMessageId: whatsappMessageId || null,
  };

  if (matchedContact) {
    messageData.contactId = matchedContact.id;
  }

  let savedMessage;
  try {
    savedMessage = await prisma.message.create({
      data: messageData,
      include: {
        contact: {
          include: { phoneNumbers: true },
        },
      },
    });
  } catch (err) {
    // Concurrent webhook retries: unique whatsappMessageId wins
    if (err.code === 'P2002' && whatsappMessageId) {
      const existingMsg = await prisma.message.findUnique({
        where: { whatsappMessageId },
        include: { contact: { include: { phoneNumbers: true } } },
      });
      if (existingMsg) {
        return { message: existingMsg, matchedContact: existingMsg.contact || null, isDuplicate: true };
      }
    }
    throw err;
  }

  // Update contact's lastMessageAt if matched
  if (matchedContact) {
    await prisma.contact.update({
      where: { id: matchedContact.id },
      data: { lastMessageAt: new Date(timestamp) },
    });

    await logActivity('whatsapp_message_matched', 'message', savedMessage.id, {
      contactName: matchedContact.name,
      matched: true,
    });
  } else {
    await logActivity('whatsapp_message_unmatched', 'message', savedMessage.id, {
      matched: false,
    });
  }

  return { message: savedMessage, matchedContact, isDuplicate: false };
}

/**
 * Get recent WhatsApp messages with contact details.
 */
async function getRecentMessages({ limit = 10, page = 1 } = {}) {
  const skip = (page - 1) * limit;

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      include: {
        contact: {
          include: { phoneNumbers: true },
        },
      },
      orderBy: { timestamp: 'desc' },
      skip,
      take: limit,
    }),
    prisma.message.count(),
  ]);

  return { messages, total, page, limit };
}

/**
 * Get unknown / unmatched WhatsApp senders.
 */
async function getUnknownSenders() {
  const unknownMessages = await prisma.message.findMany({
    where: { contactId: null },
    orderBy: { timestamp: 'desc' },
  });

  // Group by normalizedPhone
  const groups = {};
  for (const msg of unknownMessages) {
    if (!groups[msg.normalizedPhone]) {
      groups[msg.normalizedPhone] = {
        normalizedPhone: msg.normalizedPhone,
        senderPhone: msg.senderPhone,
        lastMessage: msg.messageText,
        lastTimestamp: msg.timestamp,
        messageCount: 0,
        messages: [],
      };
    }
    groups[msg.normalizedPhone].messageCount++;
    groups[msg.normalizedPhone].messages.push(msg);
  }

  return Object.values(groups);
}

/**
 * Save an unknown WhatsApp sender as a new contact in MongoDB.
 * Links all prior messages from this sender to the new contact.
 */
async function saveUnknownSender({ name, phone, email = null, notes = null, defaultCountry = 'PK' }) {
  if (!name || !name.trim()) throw new ValidationError('Name is required');
  if (!phone || !phone.trim()) throw new ValidationError('Phone number is required');

  const normResult = normalizePhoneNumber(phone, defaultCountry);
  if (!normResult.isValid) {
    throw new ValidationError(`Invalid phone number: ${normResult.error}`);
  }

  const existingPhone = await prisma.phoneNumber.findUnique({
    where: { normalizedNumber: normResult.normalizedNumber },
    include: { contact: { include: { phoneNumbers: true } } },
  });
  if (existingPhone) {
    await prisma.message.updateMany({
      where: {
        contactId: null,
        OR: [
          { normalizedPhone: normResult.normalizedNumber },
          { senderPhone: phone.trim() },
        ],
      },
      data: { contactId: existingPhone.contactId },
    });
    return existingPhone.contact;
  }

  // Create Contact in MongoDB
  const contact = await prisma.contact.create({
    data: {
      name: name.trim(),
      email: email?.trim() || null,
      notes: notes?.trim() || null,
      source: 'whatsapp',
      phoneNumbers: {
        create: {
          originalNumber: phone.trim(),
          normalizedNumber: normResult.normalizedNumber,
          countryCode: normResult.countryCode,
          nationalNumber: normResult.nationalNumber,
          isPrimary: true,
        },
      },
    },
    include: {
      phoneNumbers: true,
    },
  });

  // Associate all past unlinked messages from this number to the new contact
  await prisma.message.updateMany({
    where: {
      OR: [
        { normalizedPhone: normResult.normalizedNumber },
        { senderPhone: phone.trim() },
      ],
    },
    data: {
      contactId: contact.id,
    },
  });

  await logActivity('unknown_sender_saved', 'contact', contact.id, {
    name: contact.name,
    phone: normResult.normalizedNumber,
    source: 'whatsapp',
  });

  return contact;
}

module.exports = {
  processIncomingMessage,
  getRecentMessages,
  getUnknownSenders,
  saveUnknownSender,
};
