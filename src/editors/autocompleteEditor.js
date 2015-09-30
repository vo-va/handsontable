import {KEY_CODES, isPrintableChar} from './../helpers/unicode';
import {stringify} from './../helpers/mixed';
import {pivot} from './../helpers/array';
import {
  addClass,
  getCaretPosition,
  getScrollbarWidth,
  getSelectionEndPosition,
  outerWidth,
  setCaretPosition,
  offset,
  getScrollableElement,
  resetCssTransform,
  innerWidth,
    } from './../helpers/dom/element';
import {getEditorConstructor, registerEditor} from './../editors';
import {HandsontableEditor} from './handsontableEditor';

var AutocompleteEditor = HandsontableEditor.prototype.extend();

/**
 * @private
 * @editor AutocompleteEditor
 * @class AutocompleteEditor
 * @dependencies HandsontableEditor
 */
AutocompleteEditor.prototype.init = function() {
  HandsontableEditor.prototype.init.apply(this, arguments);

  this.query = null;
  this.choices = [];
};

AutocompleteEditor.prototype.beginEditing = function(initialValue, event) {
  if (this.state != Handsontable.EditorState.VIRGIN) {
    return;
  }
  this.instance.view.scrollViewport(new WalkontableCellCoords(this.row, this.col));
  this.instance.view.render();
  this.state = Handsontable.EditorState.EDITING;
  initialValue = typeof initialValue == 'string' ? initialValue : this.originalValue;
  this.setValue(stringify(initialValue));

  // not supported Promises :( so use callback
  var that = this;
  this._queryChoices(this.TEXTAREA.value, function(){
    if (that.maxAvailableRows === undefined) {
      that.calculateLimits();
    }

    if (that.needCalculateMaringUp === true) {
      that.calculateMarginUp();
      that.applyMarginUp();
    }

    that.open(event);
    that._opened = true;
    that.focus();
    that.instance.view.render();
  });
};

AutocompleteEditor.prototype.createElements = function() {
  HandsontableEditor.prototype.createElements.apply(this, arguments);

  addClass(this.htContainer, 'autocompleteEditor');
  addClass(this.htContainer, window.navigator.platform.indexOf('Mac') !== -1 ? 'htMacScroll' : '');
};

var skipOne = false;
function onBeforeKeyDown(event) {
  skipOne = false;
  var editor = this.getActiveEditor();

  if (isPrintableChar(event.keyCode) || event.keyCode === KEY_CODES.BACKSPACE ||
    event.keyCode === KEY_CODES.DELETE || event.keyCode === KEY_CODES.INSERT) {
    var timeOffset = 0;

    // on ctl+c / cmd+c don't update suggestion list
    if (event.keyCode === KEY_CODES.C && (event.ctrlKey || event.metaKey)) {
      return;
    }
    if (!editor.isOpened()) {
      timeOffset += 10;
    }

    if (editor.htEditor) {
      editor.instance._registerTimeout(setTimeout(function() {
        editor.queryChoices(editor.TEXTAREA.value);
        skipOne = true;
      }, timeOffset));
    }
  }
}

AutocompleteEditor.prototype.prepare = function() {
  this.instance.addHook('beforeKeyDown', onBeforeKeyDown);
  HandsontableEditor.prototype.prepare.apply(this, arguments);
};

AutocompleteEditor.prototype.open = function() {
  // Ugly fix for handsontable which grab window object for autocomplete scroll listener instead table element.
  this.TEXTAREA_PARENT.style.overflow = 'auto';
  HandsontableEditor.prototype.open.apply(this, arguments);
  this.TEXTAREA_PARENT.style.overflow = '';

  var choicesListHot = this.htEditor.getInstance();
  var that = this;
  var trimDropdown = this.cellProperties.trimDropdown === void 0 ? true : this.cellProperties.trimDropdown;

  this.TEXTAREA.style.visibility = 'visible';
  this.focus();

  choicesListHot.updateSettings({
    colWidths: trimDropdown ? [outerWidth(this.TEXTAREA) - 2] : void 0,
    width: trimDropdown ? outerWidth(this.TEXTAREA) + getScrollbarWidth() + 2 : void 0,
    afterRenderer: function(TD, row, col, prop, value) {
      var caseSensitive = this.getCellMeta(row, col).filteringCaseSensitive === true,
        indexOfMatch,
        match,
        value = stringify(value);

      if (value) {
        indexOfMatch = caseSensitive ? value.indexOf(this.query) : value.toLowerCase().indexOf(that.query.toLowerCase());

        if (indexOfMatch != -1) {
          match = value.substr(indexOfMatch, that.query.length);
          TD.innerHTML = value.replace(match, '<strong>' + match + '</strong>');
        }
      }
    },
    autoColumnSize: true,
    modifyColWidth: function(width, col) {
      // workaround for <strong> text overlapping the dropdown, not really accurate
      let autoWidths = this.getPlugin('autoColumnSize').widths;

      if (autoWidths[col]) {
        width = autoWidths[col];
      }

      return trimDropdown ? width : width + 15;
    }
  });

  // Add additional space for autocomplete holder
  this.htEditor.view.wt.wtTable.holder.parentNode.style['padding-right'] = getScrollbarWidth() + 2 + 'px';

  if (skipOne) {
    skipOne = false;
  }

  that.instance._registerTimeout(setTimeout(function() {
    if (that.TEXTAREA.value !== ''){
      that.queryChoices(that.TEXTAREA.value, that.choices);
    } else {
      that.queryChoices(that.TEXTAREA.value);
    }

  }, 0));
};

AutocompleteEditor.prototype.resetLimis = function() {
  this.maxAvailableRows = undefined;
  this.needCalculateMaringUp = false;
  delete this.marginUp ;
};

 
AutocompleteEditor.prototype.limitRows = function(availableHeigh, rowHeight) {
  this.maxAvailableRows = Math.floor(availableHeigh/rowHeight);  
};

AutocompleteEditor.prototype.calculateLimits = function() {
  var originRowToShow = this.cellProperties.visibleRows;
  var topOffset = this.TD.offsetTop - this.instance.view.wt.wtOverlays.topOverlay.getScrollPosition();

  var height = this.TD.scrollHeight + 1;
  var windowHeigh = window.innerHeight;
  var heightToBottom = windowHeigh - topOffset - height;  // -heigh - height of textarea
  var heightToTop = topOffset;
  
  var maxAssumedHeigh = originRowToShow * height;
  if (heightToBottom >= maxAssumedHeigh) {
    //drow down
    this.needCalculateMaringUp = false;
  } else if (topOffset >=  maxAssumedHeigh) {
    //draw up
    this.needCalculateMaringUp = true;
  } else if (heightToBottom === heightToTop) {
    //draw down
    // and limit
    this.limitRows(heightToBottom, height);
    this.needCalculateMaringUp = false;

  } else {
    if (heightToBottom > heightToTop) {
      //draw down
      // and limit
      this.limitRows(heightToBottom, height);
      this.needCalculateMaringUp = false;
    } else {
      //draw up
      // and limit
      this.limitRows(heightToTop, height);
      this.needCalculateMaringUp = true;
    }
  }
};

AutocompleteEditor.prototype.calculateMarginUp = function() {
  var rowsWillBeShowed = Math.min(this.choices.length, this.maxAvailableRows | this.cellProperties.visibleRows);
  this.marginUp = - (rowsWillBeShowed + 1) * (this.TD.scrollHeight + 1) - 8;
};

AutocompleteEditor.prototype.applyMarginUp = function() {
  var domNodePtr;
  if (this.marginUp !== undefined) {
    if (this.htEditor === undefined) { // htEditor not created yet, so use htContainer to set style
      domNodePtr = this.htContainer;
    } else {
      domNodePtr = this.htEditor.rootElement;
    }
    domNodePtr.style.marginTop = this.marginUp + 'px';
  }
};

AutocompleteEditor.prototype.clearMaring = function() {
  this.htEditor.rootElement.style.marginTop = '';
};

AutocompleteEditor.prototype.close = function () {
  HandsontableEditor.prototype.close.apply(this, arguments);
  this.resetLimis();
  this.clearMaring();
};

AutocompleteEditor.prototype._queryChoices = function(query, setChoiceLength) {
  // to know length of choices list
  this.query = query;

  if (typeof this.cellProperties.source == 'function') {
    var that = this;
    this.cellProperties.source(query, function(choices) {
      that.choices = choices;
      setChoiceLength();
    });
  } else if (Array.isArray(this.cellProperties.source)) {
    var choices;
    if (!query || this.cellProperties.filter === false) {
      choices = this.cellProperties.source;
    } else {
      var filteringCaseSensitive = this.cellProperties.filteringCaseSensitive === true;
      var lowerCaseQuery = query.toLowerCase();
      choices = this.cellProperties.source.filter(function(choice) {
        if (filteringCaseSensitive) {
          return choice.indexOf(query) != -1;
        } else {
          return choice.toLowerCase().indexOf(lowerCaseQuery) != -1;
        }
      });
    }
   this.choices = choices;
   setChoiceLength();
  } else {
    this.choices = [];
    setChoiceLength();
  }
};

AutocompleteEditor.prototype.queryChoices = function(query, _choices) {
  if (_choices !== undefined) {
    this.updateChoicesList(_choices);
    return;
  }

  this.query = query;

  if (typeof this.cellProperties.source == 'function') {
    var that = this;

    this.cellProperties.source(query, function(choices) {
      that.updateChoicesList(choices);
    });

  } else if (Array.isArray(this.cellProperties.source)) {

    var choices;

    if (!query || this.cellProperties.filter === false) {
      choices = this.cellProperties.source;
    } else {

      var filteringCaseSensitive = this.cellProperties.filteringCaseSensitive === true;
      var lowerCaseQuery = query.toLowerCase();

      choices = this.cellProperties.source.filter(function(choice) {

        if (filteringCaseSensitive) {
          return choice.indexOf(query) != -1;
        } else {
          return choice.toLowerCase().indexOf(lowerCaseQuery) != -1;
        }

      });
    }

    this.updateChoicesList(choices);

  } else {
    this.updateChoicesList([]);
  }

};

AutocompleteEditor.prototype.updateChoicesList = function(choices) {
  var pos = getCaretPosition(this.TEXTAREA),
    endPos = getSelectionEndPosition(this.TEXTAREA);

  var orderByRelevance = AutocompleteEditor.sortByRelevance(this.getValue(), choices, this.cellProperties.filteringCaseSensitive);
  var highlightIndex;

  /* jshint ignore:start */
  if (this.cellProperties.filter != false) {
    var sorted = [];
    for (var i = 0, choicesCount = orderByRelevance.length; i < choicesCount; i++) {
      sorted.push(choices[orderByRelevance[i]]);
    }
    highlightIndex = 0;
    choices = sorted;
  } else {
    highlightIndex = orderByRelevance[0];
  }
  /* jshint ignore:end */

  this.choices = choices;
  this.updateDropdownHeight();
  this.htEditor.loadData(pivot([choices]));


  if (this.cellProperties.strict === true) {
    this.highlightBestMatchingChoice(highlightIndex);
  }

  this.instance.listen();
  this.TEXTAREA.focus();
  setCaretPosition(this.TEXTAREA, pos, (pos != endPos ? endPos : void 0));
};

AutocompleteEditor.prototype.updateDropdownHeight = function() {
  var currentDropdownWidth = this.htEditor.getColWidth(0) + getScrollbarWidth() + 2;
  var trimDropdown = this.cellProperties.trimDropdown === void 0 ? true : this.cellProperties.trimDropdown;

  if (this.maxAvailableRows === undefined) {
    this.calculateLimits();
  }

  if (this.needCalculateMaringUp === true) {
    this.calculateMarginUp();
    this.applyMarginUp();
  }


  this.htEditor.updateSettings({
    height: this.getDropdownHeight(),
    width: trimDropdown ? void 0 : currentDropdownWidth
  });

  this.htEditor.view.wt.wtTable.alignOverlaysWithTrimmingContainer();
};

AutocompleteEditor.prototype.finishEditing = function(restoreOriginalValue) {
  if (!restoreOriginalValue) {
    this.instance.removeHook('beforeKeyDown', onBeforeKeyDown);
  }
  HandsontableEditor.prototype.finishEditing.apply(this, arguments);
};

AutocompleteEditor.prototype.highlightBestMatchingChoice = function(index) {
  if (typeof index === "number") {
    this.htEditor.selectCell(index, 0);
  } else {
    this.htEditor.deselectCell();
  }
};

/**
 * Filters and sorts by relevance
 * @param value
 * @param choices
 * @param caseSensitive
 * @returns {Array} array of indexes in original choices array
 */
AutocompleteEditor.sortByRelevance = function(value, choices, caseSensitive) {

  var choicesRelevance = [],
    currentItem, valueLength = value.length,
    valueIndex, charsLeft, result = [],
    i, choicesCount;

  if (valueLength === 0) {
    for (i = 0, choicesCount = choices.length; i < choicesCount; i++) {
      result.push(i);
    }
    return result;
  }

  for (i = 0, choicesCount = choices.length; i < choicesCount; i++) {
    currentItem = stringify(choices[i]);

    if (caseSensitive) {
      valueIndex = currentItem.indexOf(value);
    } else {
      valueIndex = currentItem.toLowerCase().indexOf(value.toLowerCase());
    }


    if (valueIndex == -1) {
      continue;
    }
    charsLeft = currentItem.length - valueIndex - valueLength;

    choicesRelevance.push({
      baseIndex: i,
      index: valueIndex,
      charsLeft: charsLeft,
      value: currentItem
    });
  }

  choicesRelevance.sort(function(a, b) {

    if (b.index === -1) {
      return -1;
    }
    if (a.index === -1) {
      return 1;
    }

    if (a.index < b.index) {
      return -1;
    } else if (b.index < a.index) {
      return 1;
    } else if (a.index === b.index) {
      if (a.charsLeft < b.charsLeft) {
        return -1;
      } else if (a.charsLeft > b.charsLeft) {
        return 1;
      } else {
        return 0;
      }
    }
  });

  for (i = 0, choicesCount = choicesRelevance.length; i < choicesCount; i++) {
    result.push(choicesRelevance[i].baseIndex);
  }

  return result;
};

AutocompleteEditor.prototype.getDropdownHeight = function() {
  var height = this.TD.scrollHeight;
  var __rows = this.maxAvailableRows | this.cellProperties.visibleRows;
  return this.choices.length >= __rows ? __rows * height : this.choices.length * height + 8;
};

AutocompleteEditor.prototype.allowKeyEventPropagation = function(keyCode) {
  let selected = {row: this.htEditor.getSelectedRange() ? this.htEditor.getSelectedRange().from.row : -1};
  let allowed = false;

  if (keyCode === KEY_CODES.ARROW_DOWN && selected.row < this.htEditor.countRows() - 1) {
    allowed = true;
  }
  if (keyCode === KEY_CODES.ARROW_UP && selected.row > -1) {
    allowed = true;
  }

  return allowed;
};

export {AutocompleteEditor};

registerEditor('autocomplete', AutocompleteEditor);
