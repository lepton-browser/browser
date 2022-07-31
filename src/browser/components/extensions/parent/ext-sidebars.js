// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//@ts-check
/// <reference types="./experiment.d.ts">

"use strict";

const sidebarURL = "chrome://browser/content/webext-panels.xhtml";

var { ExtensionParent } = ChromeUtils.import(
  "resource://gre/modules/ExtensionParent.jsm"
);

var { ContextMenu } = ChromeUtils.import("resource://gre/modules/ContextMenu.jsm")

var { IconDetails, StartupCache } = ExtensionParent;

class Sidebar {
  /**
   * @param {string} name
   * @param {any} extention
   * @param {number} id
   * @param {string} webviewUrl
   * @param {string} iconUrl
   * @param {boolean} isBottom
   * @param {boolean} browserStyle
   *
   * @todo Move this to the builder patern
   */
  constructor(id, extention, name, webviewUrl, iconUrl, isBottom, browserStyle) {
    this.extentionIndex = id;
    this.extension = extention;
    this.extensionName = extention.name;
    this.title = name;
    this.webviewUrl = webviewUrl;
    this.iconUrl = iconUrl;
    this.isBottom = isBottom;
    this.browserStyle = browserStyle;

    this.baseId = `${this.extensionName.replaceAll(' ', '-')}-index-${this.extentionIndex}`;
    this.keyId = `ext-key-id-${this.baseId}`;
    this.menuId = `ext-menu-id-${this.baseId}`;
    this.buttonId = `ext-button-id-${this.baseId}`;

    this.defaults = {
      enabled: true,
      title: this.title,
      icon: IconDetails.normalize({ path: this.iconUrl }, this.extension),
      panel: this.webviewUrl || "",
      isBottom: this.isBottom,
    };
    this.globals = Object.create(this.defaults);

    this.tabContext = new TabContext(target => {
      let window = target.ownerGlobal;
      if (target === window) {
        return this.globals;
      }
      return this.tabContext.get(window);
    });

    /**
     * @type {ContextMenu}
     */
    this.contextMenu = new ContextMenu([
      {
        l10nId: 'sidebar-context-delete',
        callId: 'delete'
      }
    ])

    

    this.contextMenu.addEvent(callId => {
      if (callId === 'delete') {
        for (let window of windowTracker.browserWindows()) {
          this.removeFromBrowserWindow(window)
        }
      }
    })
  }

  updateHeader(event) {
    let window = event.target.ownerGlobal
    let details = this.tabContext.get(window.gBrowser.selectedTab)
    let header = window.document.getElementById('sidebar-switcher-target')
    if (window.SidebarUI.currentID === this.keyId) {
      this.setMenuIcon(header, details)
    }
  }

  getIcon(size) {
    return IconDetails.escapeUrl(
      IconDetails.getPreferredIcon(this.iconUrl, this.extension, size).icon
    );
  }


  setMenuIcon(menuitem, icon) {
    menuitem.setAttribute(
      "style",
      `
      --webextension-menuitem-image: url("${this.getIcon(16)}");
      --webextension-menuitem-image-2x: url("${this.getIcon(32)}");
    `
    );
  }

  async removeFromBrowserWindow(window) {
    let { document, SidebarUI } = window;
    SidebarUI.sidebars.delete(this.keyId)
    document.getElementById("sidebar-background-" + this.keyId).remove()
    document.getElementById('sidebar-switcher-target').removeEventListener('SidebarShown', this.updateHeader.bind(this))
    SidebarUI.hide()
  }

  async addToBrowserWindow(window) {
    // Theft the sidebar UI from the window object
    let { document, SidebarUI } = window;

    // Add sidebar information to SidebarUI
    SidebarUI.sidebars.set(this.keyId, {
      title: this.title,
      url: sidebarURL,
      menuId: this.menuId,
      buttonId: this.buttonId,
      // The following properties are specific to extensions
      extensionId: this.extension.id,
      browserStyle: this.browserStyle,
      iconurl: this.getIcon(32),
      panel: this.webviewUrl,
      isBottom: this.isBottom
    });

    // Generate the header information
    let header = document.getElementById('sidebar-switcher-target')
    header.addEventListener('SidebarShown', this.updateHeader.bind(this))

    // Insert a menuitem for View->Show Sidebars.
    let menuitem = document.createXULElement("menuitem");
    menuitem.setAttribute("id", this.menuId);
    menuitem.setAttribute("type", "checkbox");
    menuitem.setAttribute("label", this.title);
    menuitem.setAttribute(
      "oncommand",
      `SidebarUI.toggle("${this.extentionIndex}");`
    );
    menuitem.setAttribute("class", "menuitem-iconic webextension-menuitem");
    menuitem.setAttribute("key", this.keyId);
    this.setMenuIcon(menuitem, this.iconUrl);
    document.getElementById('viewSidebarMenu').appendChild(menuitem)

    // Add to the sidebar tabs on the side of the window
    await SidebarUI.createSidebarItem(this.keyId, SidebarUI.sidebars.get(this.keyId));

    // Get the element based on the id of `sidebar-background-${this.keyId}`
    // Set the attribute 'context' to 'hello'
    this.contextMenu.addToBrowser(window)
    console.log(`sidebar-background-${this.keyId}`)
    let sidebar = window.document.getElementById(`sidebar-background-${this.keyId}`)
    sidebar.setAttribute('context', this.contextMenu.contextMenuId)

    return menuitem;
  }
  
}

class ConfigAPI extends ExtensionAPI {
  /**
   * @param {any} extension
   */
  constructor(extension) {
    super(extension);

    this.currentIndex = 0;
    /** @type {Map<number, Sidebar>} */
    this.sidebars = new Map();
  }

  /**
   * @param {any} context
   */
  getAPI(context) {
    let { extension } = context

    return {
      sidebars: {
        // What do we want?
        // - [ ] Register sidebar - returns an ID
        // - [ ] Get a sidebar using an ID
        // - [ ] List the sidebars created by the extension
        // - [ ] Modify sidebar with ID <- Split into seperate functions
        // - [ ] Remove a sidebar

        /**
         * @param {{ title: string, iconUrl: string, webviewUrl: string, isBottom?: boolean, browserStyle?: boolean }} config The config provided by the programer
         */
        add: async (config) => {
          // Get a url that can be used by the browser for this specific panel 
          // to work correctly
          const url = context.uri.resolve(config.webviewUrl)
          if (!context.checkLoadURL(url)) {
            return Promise.reject({
              message: `Access to the url ${url} (from ${config.webviewUrl}) was denied`
            })
          }

          // Get the icon url
          const iconUrl = IconDetails.normalize({ path: config.iconUrl }, extension)
          console.log(iconUrl)

          const id = ++this.currentIndex;

          const sidebar = new Sidebar(
            id,
            extension,
            config.title,
            url,
            iconUrl,
            config.isBottom,
            config.browserStyle || false
          );

          for (let window of windowTracker.browserWindows()) {
            sidebar.addToBrowserWindow(window);
          }

          this.sidebars.set(id, sidebar);

          return id;
        },

        get: async (/** @type {any} */ id) => {
          console.log(id);

          return this.sidebars.get(id);
        },

        list: async () => {
          console.log(self.sidebars);

          return [...this.sidebars.keys()];
        },

        remove: async (/** @type {any} */ id) => {
          const sidebar = this.sidebars.get(id)

          for (let window of windowTracker.browserWindows()) {
            sidebar.removeFromBrowserWindow(window)
          }

          this.sidebars.delete(id);
        },
      },
    };
  }
}

var sidebars; // identifier from the manifest (key in experiment_apis). __FORMERLY__ COULD BE ANY matching the key in experiment_apis within the manifest. NOW it MUST match API name !!!
sidebars = ConfigAPI; //let, const, class, export or without var don't work.