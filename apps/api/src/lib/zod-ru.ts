import { z, ZodIssueCode, type ZodErrorMap } from 'zod';

/**
 * Глобальная русская карта ошибок zod (установлен zod 3.x — используем v3 API z.setErrorMap).
 * Сообщения, явно заданные в схемах, имеют приоритет над этой картой.
 */
const TYPE_RU: Record<string, string> = {
  string: 'строка',
  number: 'число',
  integer: 'целое число',
  bigint: 'целое число',
  boolean: 'да/нет',
  object: 'объект',
  array: 'список',
  date: 'дата',
  null: 'null',
  undefined: 'пусто',
};

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const ruErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: 'Обязательное поле' };
      return { message: `Неверный тип: ожидается ${TYPE_RU[issue.expected] ?? issue.expected}` };
    case ZodIssueCode.invalid_literal:
      return { message: 'Недопустимое значение' };
    case ZodIssueCode.invalid_enum_value:
      return { message: `Недопустимое значение. Допустимо: ${issue.options.join(', ')}` };
    case ZodIssueCode.invalid_union:
    case ZodIssueCode.invalid_union_discriminator:
      return { message: 'Некорректное значение' };
    case ZodIssueCode.unrecognized_keys:
      return { message: `Лишние поля: ${issue.keys.join(', ')}` };
    case ZodIssueCode.invalid_date:
      return { message: 'Некорректная дата' };
    case ZodIssueCode.invalid_string: {
      const v = issue.validation;
      if (v === 'email') return { message: 'Некорректный email' };
      if (v === 'url') return { message: 'Некорректная ссылка' };
      if (v === 'uuid' || v === 'cuid' || v === 'cuid2' || v === 'ulid') return { message: 'Некорректный идентификатор' };
      if (v === 'datetime' || v === 'date' || v === 'time') return { message: 'Некорректная дата/время' };
      if (v === 'regex') return { message: 'Неверный формат' };
      if (typeof v === 'object' && 'startsWith' in v) return { message: `Должно начинаться с «${v.startsWith}»` };
      if (typeof v === 'object' && 'endsWith' in v) return { message: `Должно заканчиваться на «${v.endsWith}»` };
      if (typeof v === 'object' && 'includes' in v) return { message: `Должно содержать «${v.includes}»` };
      return { message: 'Неверный формат строки' };
    }
    case ZodIssueCode.too_small: {
      const n = Number(issue.minimum);
      if (issue.type === 'string') {
        if (n === 1 && !issue.exact) return { message: 'Поле не может быть пустым' };
        return { message: issue.exact ? `Должно быть ровно ${n} ${plural(n, 'символ', 'символа', 'символов')}` : `Минимум ${n} ${plural(n, 'символ', 'символа', 'символов')}` };
      }
      if (issue.type === 'array' || issue.type === 'set') return { message: issue.exact ? `Нужно ровно ${n} эл.` : `Нужно не меньше ${n} эл.` };
      if (issue.type === 'date') return { message: 'Слишком ранняя дата' };
      return { message: issue.inclusive ? `Значение должно быть не меньше ${n}` : `Значение должно быть больше ${n}` };
    }
    case ZodIssueCode.too_big: {
      const n = Number(issue.maximum);
      if (issue.type === 'string') return { message: issue.exact ? `Должно быть ровно ${n} ${plural(n, 'символ', 'символа', 'символов')}` : `Максимум ${n} ${plural(n, 'символ', 'символа', 'символов')}` };
      if (issue.type === 'array' || issue.type === 'set') return { message: `Не больше ${n} эл.` };
      if (issue.type === 'date') return { message: 'Слишком поздняя дата' };
      return { message: issue.inclusive ? `Значение должно быть не больше ${n}` : `Значение должно быть меньше ${n}` };
    }
    case ZodIssueCode.not_multiple_of:
      return { message: `Значение должно быть кратно ${issue.multipleOf}` };
    case ZodIssueCode.not_finite:
      return { message: 'Число должно быть конечным' };
    case ZodIssueCode.custom:
      return { message: 'Некорректное значение' };
    default:
      return { message: ctx.defaultError === 'Required' ? 'Обязательное поле' : 'Некорректное значение' };
  }
};

let installed = false;
export function installRuErrorMap(): void {
  if (installed) return;
  z.setErrorMap(ruErrorMap);
  installed = true;
}
installRuErrorMap();
