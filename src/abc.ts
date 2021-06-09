import axios from 'axios';
import cheerio from 'cheerio';
import better_sqlite3 from 'better-sqlite3';

const db = better_sqlite3('db.sqlite3');

function check_db_table_exists(table_name: string) {
  const table = check_db_table_exists.sql.get(table_name);
  return table && table.name ? true : false;
}
check_db_table_exists.sql = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
);
if (!check_db_table_exists('kv')) {
  db.exec(
    `
    create table colls (id primary key, name text, href text, desc text);
    create table items (id text, coll_id references colls(id), url text, type text, title text, content text, author_name text, created_at);
    create table kv (key primary key, value);
    insert into kv values ('progress', '{}');
    `,
  );
}

const insert_coll = db.prepare(
  `insert into colls values (:id, :name, :href, :desc)`,
);
const insert_item = db.prepare(
  `insert into items values (:id, :coll_id, :url, :type, :title, :content, :author_name, :created_at)`,
);
const get_progress = db.prepare(`select value from kv where key='progress'`);
const set_progress = db.prepare(`update kv set value = ? where key='progress'`);

function delay_random(min: number, max: number) {
  return new Promise((res) =>
    setTimeout(res, min + Math.random() * (max - min)),
  );
};
type Coll = {
  id: string,
  name: string,
  href: string,
  desc: string;
  user_collections_url: string;
}
type Progress = {
  user_collections_url?: string;
  colls?: Coll[],
  coll_idx?: number;
  offset?: number;
}

async function main(user_collections_url: string) {
  let progress: Progress = JSON.parse(get_progress.get().value);
  if (!progress.colls || progress.user_collections_url !== user_collections_url) {
    const collections_res = await axios.get(user_collections_url);
    const colls_dom = cheerio.load(collections_res.data as string);
    const colls_doms = Array.from(
      colls_dom('#ProfileMain div.Card.SelfCollectionItem'),
    );
    const colls = colls_doms.map((dom) => {
      const a = cheerio('a.SelfCollectionItem-title', dom);
      const desc = cheerio('div.SelfCollectionItem-description', dom);
      const href = a.attr('href')!;
      const id = href.split('/').slice(-1)[0];
      return { name: a.text(), href, id, desc: desc.text(), user_collections_url };
    });
    progress = { user_collections_url, colls };
    set_progress.run(JSON.stringify(progress));
  }
  for (const coll of progress.colls!) {
    const coll_idx = progress.colls!.indexOf(coll);
    if (coll_idx < progress.coll_idx!) {
      continue;
    }
    progress.coll_idx = coll_idx;
    set_progress.run(JSON.stringify(progress));

    let offset = 0;
    insert_coll.run(coll);
    console.log(`inserted coll:`, coll.name);
    while (true) {
      const coll_items_res = await axios.get(
        `https://www.zhihu.com/api/v4/collections/${coll.id}/items`,
        { params: { offset, limit: 20 } },
      );
      const items = coll_items_res.data.data;
      if (items.length === 0) {
        break;
      }
      for (const item of items) {
        const type = item.content.type;
        const id = item.content.id + '';
        const url = item.content.url;
        const created_at = item.created;
        const author_name = item.content.author?.name || '';
        let title = '';
        let content = '';
        if (type === 'pin') {
          title = item.content.excerpt_title;
          content = item.content.content.reduce(
            (acc: string, cv: any) =>
              acc + cheerio.load(cv.content || '').text(),
            '',
          );
        } else if (type === 'answer') {
          title = item.content.question.title;
          content = item.content.excerpt;
        } else if (type === 'zvideo') {
          title = item.content.title;
        } else if (type === 'article') {
          title = item.content.title;
          content = item.content.excerpt_title;
        } else {
          throw new Error(JSON.stringify(item));
        }
        insert_item.run({
          id,
          coll_id: coll.id,
          url,
          type,
          title,
          content,
          author_name,
          created_at,
        });
        console.log(`inserted item:`, title);
      }
      offset += 20;
      await delay_random(500, 2000);
    }
  }
}

main('https://www.zhihu.com/people/xia-lu-jun-94/collections');
