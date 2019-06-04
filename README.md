# @fanfic/scanner

A not-ready-for-publication fanfic update scanner.

This needs:

* Docs:
  * Config and CLI docs.
  * Docs for how this works w/ @fanfic/proxy
  * Docs for network streaming API
  * Docs for what it does, eg, the `.db` serialized form of the database.

* Database migration:
  * Right now it can create a db from scratch, but there's no update
    facility, which is clearly mandatory before this is published.

* Site support:
  * The whole code structure is weird here, scrapers should be split out
    possibly into their own stand alone module or modules.
  * Just everything to do with site.js needs to be less backwards.
  * Currently ao3, ffnet, wattpad, scryer (an index of ffnet) and forums
    using XenForo are supported.  More sites would be lovely, but certainly
    not release blocking.

That said, it works pretty well, and I have it running continualy on my
laptop.  It automatically catches up after sleeps and the `.db` files being
outputted, along with configs, are all you need to backup to restore if your
database gets wiped.
