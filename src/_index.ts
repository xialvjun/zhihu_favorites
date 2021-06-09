import puppeteer from 'puppeteer-core';
import better_sqlite3 from 'better-sqlite3';
import { crap_user_url } from '../config';

const CHROME_EXECUTABLE_PATH =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const db = better_sqlite3('db.sqlite3');

function check_db_table_exists(table_name: string) {
  const table = check_db_table_exists.sql.get(table_name);
  return table && table.name ? true : false;
}
check_db_table_exists.sql = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
);

function build_schema() {
  if (!check_db_table_exists('favorites')) {
    db.exec(
      `create table favorites (id primary key, title text, href text, coll text, _typ text, author text)`,
    );
  }
  if (!check_db_table_exists('temp_data')) {
    db.exec(
      `create table temp_data (json text); insert into temp_data (json) values ('{}')`,
    );
  }
}

async function main() {
  build_schema();

  const ins_favor = db.prepare(
    `insert into favorites (id,title,href,coll,_typ,author) values (:id,:title,:href,:coll,:_typ,:author)`,
  );
  const set_temp = db.prepare(`update temp_data set json = ?`);
  const get_temp = db.prepare(`select json from temp_data`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_EXECUTABLE_PATH,
    // headless: false,
  });
  const page = await browser.newPage();
  const temp: {
    colls: { name: string; href: string }[];
    coll_idx: number;
    page: number;
  } = JSON.parse(get_temp.get().json);
  if (!temp.colls) {
    await page.goto(crap_user_url);
    await page.waitForSelector('#ProfileMain > div:nth-child(4)');
    const links = await page.evaluate(() => {
      const links: NodeListOf<HTMLLinkElement> = document.querySelectorAll(
        '#ProfileMain > div:nth-child(4) a',
      );
      const ls: { name: string; href: string }[] = [];
      links.forEach((link) =>
        ls.push({ name: link.textContent!, href: link.href }),
      );
      return ls;
    });
    console.log(links);
    temp.colls = links;
  }
  for (const coll of temp.colls) {
    const coll_idx = temp.colls.indexOf(coll);
    if (coll_idx < temp.coll_idx) {
      continue;
    }
    temp.coll_idx = coll_idx;
    set_temp.run(JSON.stringify(temp));
    while (true) {
      temp.page ??= 1;
      console.log(`goto: ` + coll.href + '?page=' + temp.page)
      await page.goto(coll.href + '?page=' + temp.page);
      const dom_selector =
        '#root > div > main > div > div.CollectionsDetailPage-mainColumn > div.Card.CollectionsDetailPage-list > div:nth-child(2) > div:nth-child(1)';
      await page.waitForSelector(dom_selector);
      const { links, has_next } = await page.evaluate(() => {
        const dom_selector =
          '#root > div > main > div > div.CollectionsDetailPage-mainColumn > div.Card.CollectionsDetailPage-list > div:nth-child(2)';
        const dom = document.querySelector(dom_selector)!;
        let cards = Array.from(dom.querySelectorAll('div.Card'));
        const links = cards.map((it) => {
          const div_ContentItem = it.querySelector(
            '.ContentItem',
          ) as HTMLDivElement;
          if (!div_ContentItem?.dataset?.zop) {
            return null!;
          }
          const { authorName: author, itemId: id, type: _typ } = JSON.parse(
            div_ContentItem.dataset.zop,
          );
          const { text: title, href } = it.querySelector('h2 a') as any;
          return { id, title, href, _typ, author };
        }).filter(v => v);
        const buttons = Array.from(
          dom.querySelectorAll('div.Pagination button'),
        );
        const next_btn = buttons.slice(-1)[0];
        const has_next = next_btn?.textContent === '下一页' ? true : false;
        return { links, has_next };
      });
      // console.log(links, has_next);
      for (const link of links) {
        (link as any).coll = coll.name;
        try {
          ins_favor.run(link);
        } catch (error) {
          console.error(error);
        }
        console.log(`inserted ${link.title} ${link.href}`);
      }
      console.log(`craped ${coll.href + '?page=' + temp.page}`);
      if (!has_next) {
        break;
      }
      temp.page += 1;
      set_temp.run(JSON.stringify(temp));
    }
    temp.coll_idx += 1;
    temp.page = 1;
    set_temp.run(JSON.stringify(temp));
  }
  process.exit(0);
}

main();
