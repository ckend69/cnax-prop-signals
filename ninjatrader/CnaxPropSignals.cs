// CNAX Prop Signals — NinjaTrader 8 Indicator  v1.2.1
//
// Add this indicator to any futures chart once. It connects to the CNAX app
// running in the background, automatically draws every signal as it arrives,
// and shows a one-click TAKE TRADE card with the correct contract size already
// calculated from your account balance and risk setting.
//
// SETUP (one time):
//   1. Open CNAX Prop Signals app — it auto-scans every 60 seconds.
//   2. NinjaTrader: Tools → Import → NinjaScript Add-On → select this file.
//   3. Open any futures chart (NQ, ES, CL, GC etc.) on 1m, 5m, 15m, 30m, or 1H.
//   4. Right-click chart → Indicators → add "CNAX Prop Signals".
//   5. Enter your Account name and Risk % — everything else is automatic.
//
// USING IT:
//   - Signals appear automatically as green/red arrows with SL/TP lines.
//   - A trade card pops up bottom-right showing direction, prices, contracts.
//   - Click TAKE TRADE → market order + OCO stop/limit bracket submitted instantly.
//   - Click SKIP (✕) to dismiss without trading.
//   - NinjaTrader ATI must be enabled: Tools → Options → Automated Trading Interface.

#region Using declarations
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Newtonsoft.Json;
using NinjaTrader.Cbi;
using NinjaTrader.Gui;
using NinjaTrader.Gui.Chart;
using NinjaTrader.NinjaScript;
using NinjaTrader.NinjaScript.DrawingTools;
#endregion

namespace NinjaTrader.NinjaScript.Indicators
{
    public class CnaxPropSignals : Indicator
    {
        // ── Futures-only symbol map ───────────────────────────────────────────
        // Forex and crypto are excluded — this indicator is futures-focused.
        private static readonly Dictionary<string, string> FuturesMap =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "NQ",  "NQ"  }, { "ES",  "ES"  }, { "YM",  "YM"  }, { "RTY", "RTY" },
            { "CL",  "CL"  }, { "GC",  "GC"  }, { "SI",  "SI"  }, { "NG",  "NG"  },
            { "MNQ", "MNQ" }, { "MES", "MES" },
        };

        // ── Poll thread state ─────────────────────────────────────────────────
        private Thread                  pollThread;
        private CancellationTokenSource cts;
        private List<CnaxSignal>        liveSignals = new List<CnaxSignal>();
        private readonly object         sigLock     = new object();
        private volatile string         statusMsg   = "CNAX  ○  waiting for app…";
        private volatile bool           connected   = false;

        // ── Executed-signal guard (thread-safe, bounded at 200 entries) ───────
        private readonly object         execLock      = new object();
        private readonly HashSet<string> executedIds  = new HashSet<string>();
        private readonly Queue<string>   executedQueue = new Queue<string>();
        private const    int             MaxExecuted   = 200;

        // ── WPF card state ────────────────────────────────────────────────────
        private Border          signalCard   = null;
        private volatile string cardSignalId = null;
        private Grid            chartGrid    = null;

        // ── Cached resources ──────────────────────────────────────────────────
        private SimpleFont _statusFont;

        // ─────────────────────────────────────────────────────────────────────
        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Description      = "Auto-draws CNAX signals on futures charts with a one-click TAKE TRADE button.";
                Name             = "CNAX Prop Signals";
                Calculate        = Calculate.OnBarClose;
                IsOverlay        = true;
                DisplayInDataBox = false;
                DrawOnPricePanel = true;

                Port          = 4242;
                PollSeconds   = 30;
                MinConfidence = 60;
                ShowSLTP      = true;
                AccountName   = "Sim101";
                RiskPercent   = 1.0;
                MaxContracts  = 5;
            }
            else if (State == State.DataLoaded)
            {
                _statusFont = new SimpleFont("Consolas", 9);
                cts         = new CancellationTokenSource();
                pollThread  = new Thread(() => PollLoop(cts.Token))
                              { IsBackground = true, Name = "CNAX-Poll" };
                pollThread.Start();

                if (ChartControl != null)
                    ChartControl.Dispatcher.InvokeAsync(FindChartGrid);
            }
            else if (State == State.Terminated)
            {
                cts?.Cancel();
                pollThread?.Join(3000);

                if (ChartControl?.Dispatcher != null
                    && !ChartControl.Dispatcher.HasShutdownStarted)
                    ChartControl.Dispatcher.InvokeAsync(RemoveCard);
            }
        }

        // ── Walk ChartControl's visual children downward to find first Grid ───
        // Walking DOWN finds the chart's own inner layout grid, not the Window root.
        private void FindChartGrid()
        {
            try
            {
                chartGrid = FindVisualChild<Grid>(ChartControl);
            }
            catch { }
        }

        private static T FindVisualChild<T>(DependencyObject parent) where T : DependencyObject
        {
            int count = VisualTreeHelper.GetChildrenCount(parent);
            for (int i = 0; i < count; i++)
            {
                var child = VisualTreeHelper.GetChild(parent, i);
                if (child is T result) return result;
                var found = FindVisualChild<T>(child);
                if (found != null) return found;
            }
            return null;
        }

        // ── Background poll loop ──────────────────────────────────────────────
        private void PollLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    string json = HttpGet(
                        string.Format(CultureInfo.InvariantCulture,
                            "http://127.0.0.1:{0}/api/signals", Port));
                    var sigs = JsonConvert.DeserializeObject<List<CnaxSignal>>(json);

                    // Capture count inside lock to avoid race on liveSignals.Count
                    int sigCount;
                    lock (sigLock)
                    {
                        liveSignals = sigs ?? new List<CnaxSignal>();
                        sigCount    = liveSignals.Count;
                    }

                    connected = true;
                    statusMsg = string.Format("CNAX  ●  {0} signal{1} live",
                        sigCount, sigCount == 1 ? "" : "s");
                }
                catch
                {
                    connected = false;
                    statusMsg = "CNAX  ○  open the CNAX app";
                }

                if (ChartControl?.Dispatcher != null
                    && !ChartControl.Dispatcher.HasShutdownStarted)
                    ChartControl.Dispatcher.InvokeAsync(
                        () => { try { ForceRefresh(); } catch { } });

                // Wait for next poll — cancellable immediately on shutdown
                token.WaitHandle.WaitOne(PollSeconds * 1000);
            }
        }

        // ── Lightweight HTTP GET with 5-second timeout ────────────────────────
        private static string HttpGet(string url)
        {
            var req              = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout          = 5000;
            req.ReadWriteTimeout = 5000;
            req.Accept           = "application/json";
            req.KeepAlive        = false;
            using (var resp   = (HttpWebResponse)req.GetResponse())
            using (var stream = resp.GetResponseStream())
            using (var reader = new StreamReader(stream))
                return reader.ReadToEnd();
        }

        // ── Bar update: draw objects + manage card ────────────────────────────
        protected override void OnBarUpdate()
        {
            if (CurrentBar < 2) return;

            string cnaxSym = MapToFutures();
            if (cnaxSym == null) return;

            List<CnaxSignal> all;
            lock (sigLock) { all = new List<CnaxSignal>(liveSignals); }

            // Status corner label (cached font)
            Draw.TextFixed(this, "cnax_st", statusMsg, TextPosition.BottomLeft,
                connected ? Brushes.DodgerBlue : Brushes.Gray,
                _statusFont, Brushes.Transparent, Brushes.Transparent, 0);

            // Find best matching signal for this chart's symbol + timeframe
            CnaxSignal match = null;
            foreach (var s in all)
            {
                // Guard null/empty fields from malformed JSON
                if (string.IsNullOrEmpty(s.symbol) || string.IsNullOrEmpty(s.direction)) continue;
                if (!s.symbol.Equals(cnaxSym, StringComparison.OrdinalIgnoreCase)) continue;
                if (s.confidence < MinConfidence) continue;
                if (!TFMatch(s.timeframe)) continue;
                if (match == null || s.confidence > match.confidence) match = s;
            }

            if (match != null)
            {
                string id  = SigId(match);
                bool   buy = match.direction.Equals("BUY", StringComparison.OrdinalIgnoreCase);

                // Arrow on current bar
                if (buy)
                    Draw.ArrowUp(this, "cnax_arrow", false, 0,
                        Low[0] - 4 * TickSize, Brushes.LimeGreen);
                else
                    Draw.ArrowDown(this, "cnax_arrow", false, 0,
                        High[0] + 4 * TickSize, Brushes.Red);

                // SL / TP lines — each guarded individually to prevent price=0 draws
                if (ShowSLTP)
                {
                    if (match.sl  > 0) Draw.HorizontalLine(this, "cnax_sl",  false, match.sl,  Brushes.OrangeRed);
                    if (match.tp1 > 0) Draw.HorizontalLine(this, "cnax_tp1", false, match.tp1, Brushes.Cyan);
                    if (match.tp2 > 0) Draw.HorizontalLine(this, "cnax_tp2", false, match.tp2, Brushes.DeepSkyBlue);
                }

                // Show card only when signal changes and hasn't been traded yet.
                // Set cardSignalId BEFORE dispatch to block duplicate InvokeAsync calls
                // across rapid bar updates before the UI thread has a chance to run.
                // CalcContracts called here (data thread) where Instrument access is safe.
                if (cardSignalId != id && !IsExecuted(id))
                {
                    cardSignalId  = id;
                    int contracts = CalcContracts(match);
                    ChartControl?.Dispatcher.InvokeAsync(() => ShowCard(match, contracts));
                }
            }
            else
            {
                // No matching signal — clear drawings and dismiss card
                RemoveDrawObject("cnax_arrow");
                RemoveDrawObject("cnax_sl");
                RemoveDrawObject("cnax_tp1");
                RemoveDrawObject("cnax_tp2");

                if (cardSignalId != null)
                {
                    cardSignalId = null;
                    ChartControl?.Dispatcher.InvokeAsync(RemoveCard);
                }
            }
        }

        // ── Build and show the floating trade card ────────────────────────────
        private void ShowCard(CnaxSignal sig, int contracts)
        {
            RemoveCard();
            if (chartGrid == null) return;

            bool   buy = sig.direction.Equals("BUY", StringComparison.OrdinalIgnoreCase);
            string id  = SigId(sig);
            cardSignalId = id; // keep in sync with data thread assignment

            var accent  = buy
                ? new SolidColorBrush(Color.FromRgb(0, 220, 100))
                : new SolidColorBrush(Color.FromRgb(220, 50,  50));
            var bgBrush = new SolidColorBrush(Color.FromArgb(235, 10, 12, 34));
            var dimmed  = new SolidColorBrush(Color.FromRgb(140, 140, 155));
            var white   = new SolidColorBrush(Colors.White);

            signalCard = new Border
            {
                Background          = bgBrush,
                BorderBrush         = accent,
                BorderThickness     = new Thickness(1),       // integer px — crisp on all DPI
                CornerRadius        = new CornerRadius(6),
                Padding             = new Thickness(16, 12, 16, 14),
                Width               = 270,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment   = VerticalAlignment.Bottom,
                Margin              = new Thickness(0, 0, 14, 50),
                IsHitTestVisible    = true,                   // ensures click events reach buttons
            };

            Panel.SetZIndex(signalCard, 9999);               // float above all chart layers

            var root = new StackPanel { Orientation = Orientation.Vertical };

            // ── Header ─────────────────────────────────────────────────────
            var headerRow = new Grid();
            headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var headerLeft = new StackPanel { Orientation = Orientation.Horizontal };

            var badge = new Border
            {
                Background   = accent,
                CornerRadius = new CornerRadius(4),
                Padding      = new Thickness(8, 3, 8, 3),
                Margin       = new Thickness(0, 0, 8, 0),
            };
            badge.Child = new TextBlock
            {
                Text       = sig.direction,
                FontSize   = 13,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(Colors.Black),
            };

            headerLeft.Children.Add(badge);
            headerLeft.Children.Add(new TextBlock
            {
                Text              = string.Format("{0}  ·  {1}", sig.symbol, sig.timeframe),
                FontSize          = 13,
                FontWeight        = FontWeights.SemiBold,
                Foreground        = white,
                VerticalAlignment = VerticalAlignment.Center,
            });

            var closeBtn = new Button
            {
                Content           = "✕",
                FontSize          = 11,
                Width             = 22,
                Height            = 22,
                Padding           = new Thickness(0),
                Background        = Brushes.Transparent,
                BorderBrush       = Brushes.Transparent,
                Foreground        = dimmed,
                VerticalAlignment = VerticalAlignment.Top,
                Cursor            = System.Windows.Input.Cursors.Hand,
            };
            closeBtn.Click += (s, e) => RemoveCard();

            Grid.SetColumn(headerLeft, 0);
            Grid.SetColumn(closeBtn,   1);
            headerRow.Children.Add(headerLeft);
            headerRow.Children.Add(closeBtn);
            headerRow.Margin = new Thickness(0, 0, 0, 10);
            root.Children.Add(headerRow);

            // ── Confidence bar ─────────────────────────────────────────────
            var confRow = new Grid { Margin = new Thickness(0, 0, 0, 10) };
            confRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            confRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var track = new Border
            {
                Height            = 5,
                Background        = new SolidColorBrush(Color.FromRgb(38, 40, 68)),
                CornerRadius      = new CornerRadius(3),
                VerticalAlignment = VerticalAlignment.Center,
            };
            var fill = new Border
            {
                Height              = 5,
                Background          = accent,
                CornerRadius        = new CornerRadius(3),
                HorizontalAlignment = HorizontalAlignment.Left,
                Width               = Math.Max(0, sig.confidence / 100.0 * 175),
            };
            var barHost = new Grid();
            barHost.Children.Add(track);
            barHost.Children.Add(fill);
            Grid.SetColumn(barHost, 0);

            var confLbl = new TextBlock
            {
                Text              = string.Format("{0:F0}%", sig.confidence),
                FontSize          = 11,
                FontWeight        = FontWeights.Bold,
                Foreground        = accent,
                Margin            = new Thickness(8, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(confLbl, 1);
            confRow.Children.Add(barHost);
            confRow.Children.Add(confLbl);
            root.Children.Add(confRow);

            // ── Price rows ─────────────────────────────────────────────────
            root.Children.Add(MakeRow("Entry",     sig.entry, white,  dimmed));
            root.Children.Add(MakeRow("Stop Loss", sig.sl,
                new SolidColorBrush(Color.FromRgb(255, 100, 80)), dimmed));
            if (sig.tp1 > 0)
                root.Children.Add(MakeRow("TP 1", sig.tp1,
                    new SolidColorBrush(Color.FromRgb(0, 220, 200)), dimmed));
            if (sig.tp2 > 0)
                root.Children.Add(MakeRow("TP 2", sig.tp2,
                    new SolidColorBrush(Color.FromRgb(80, 180, 255)), dimmed));
            if (sig.rr > 0)
                root.Children.Add(MakeRow("R : R", sig.rr, dimmed, dimmed, "F1", "×"));

            // ── Contracts row ──────────────────────────────────────────────
            root.Children.Add(new Border
            {
                Height     = 1,
                Background = new SolidColorBrush(Color.FromRgb(35, 37, 60)),
                Margin     = new Thickness(0, 8, 0, 8),
            });
            root.Children.Add(MakeRow(
                string.Format("Contracts  ({0:F1}% risk)", RiskPercent),
                contracts, accent, dimmed, "F0", ""));

            // ── TAKE TRADE button ──────────────────────────────────────────
            var tradeBtn = new Button
            {
                Content         = buy ? "▲  TAKE TRADE" : "▼  TAKE TRADE",
                Height          = 44,
                FontSize        = 14,
                FontWeight      = FontWeights.Bold,
                Background      = accent,
                Foreground      = new SolidColorBrush(Colors.Black),
                BorderThickness = new Thickness(0),
                Margin          = new Thickness(0, 10, 0, 0),
                Cursor          = System.Windows.Input.Cursors.Hand,
            };
            tradeBtn.Click += (s, e) =>
            {
                AddExecuted(id);
                Task.Run(() => SubmitOrder(sig, contracts)); // off UI thread
                RemoveCard();
            };
            root.Children.Add(tradeBtn);

            signalCard.Child = root;
            chartGrid.Children.Add(signalCard);
        }

        // Helper: two-column label + value row
        private Grid MakeRow(string label, double value, Brush valBrush, Brush lblBrush,
                              string fmt = "F5", string suffix = "")
        {
            var row = new Grid { Margin = new Thickness(0, 3, 0, 0) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var lbl = new TextBlock { Text = label, FontSize = 11, Foreground = lblBrush };
            var val = new TextBlock
            {
                Text       = value.ToString(fmt) + suffix,
                FontSize   = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = valBrush,
            };
            Grid.SetColumn(lbl, 0); Grid.SetColumn(val, 1);
            row.Children.Add(lbl); row.Children.Add(val);
            return row;
        }

        // ── Remove card from chart (must run on UI thread) ────────────────────
        // Note: cardSignalId is intentionally NOT cleared here — it is managed
        // by OnBarUpdate so ShowCard deduplication remains accurate.
        private void RemoveCard()
        {
            try
            {
                if (signalCard != null && chartGrid != null
                    && chartGrid.Children.Contains(signalCard))
                    chartGrid.Children.Remove(signalCard);
            }
            catch { }
            finally { signalCard = null; }
        }

        // ── Auto position sizing (called on data thread in OnBarUpdate) ────────
        // Uses an Account instance from Account.All — safe in both strategies
        // and indicators (unlike the static Account.Get() which is null here).
        private int CalcContracts(CnaxSignal sig)
        {
            try
            {
                var account = Account.All.FirstOrDefault(
                    a => a.Name.Equals(AccountName, StringComparison.OrdinalIgnoreCase));
                if (account == null) return 1;

                double balance      = account.Get(AccountItem.CashValue, Currency.UsDollar);
                double riskDollars  = balance * (RiskPercent / 100.0);
                double slDist       = Math.Abs(sig.entry - sig.sl);
                double tickSz       = Instrument.MasterInstrument.TickSize;
                double tickVal      = Instrument.MasterInstrument.PointValue * tickSz;
                double slTicks      = slDist / tickSz;
                double riskPerContr = slTicks * tickVal;

                if (riskPerContr <= 0) return 1;
                int contracts = (int)Math.Floor(riskDollars / riskPerContr);
                return Math.Max(1, Math.Min(contracts, MaxContracts));
            }
            catch
            {
                return 1;
            }
        }

        // ── Submit bracket order via NT8 ATI — runs off UI thread ─────────────
        // SL and TP are submitted with a shared OCO group so that when one fills,
        // the other is automatically cancelled by NT8, preventing orphaned orders.
        private void SubmitOrder(CnaxSignal sig, int contracts)
        {
            try
            {
                string inst   = Instrument.FullName;
                bool   buy    = sig.direction.Equals("BUY", StringComparison.OrdinalIgnoreCase);
                string action = buy ? "BUY" : "SELL";
                string exit   = buy ? "SELL" : "BUY";

                // OCO group name is unique per signal — ties SL and TP together
                string ocoGrp = "cnax_" + Math.Abs(SigId(sig).GetHashCode()).ToString(
                    CultureInfo.InvariantCulture);

                using (var tcp    = new TcpClient("127.0.0.1", 36973))
                using (var stream = tcp.GetStream())
                {
                    Action<string> send = cmd =>
                    {
                        var b = Encoding.UTF8.GetBytes(cmd + "\n");
                        stream.Write(b, 0, b.Length);
                        Thread.Sleep(150);
                    };

                    // Entry: market order
                    send(string.Format(CultureInfo.InvariantCulture,
                        "PLACE;Account={0};Instrument={1};Action={2};Qty={3};OrderType=MARKET;TIF=DAY",
                        AccountName, inst, action, contracts));

                    // Stop loss (OCO group A)
                    if (sig.sl > 0)
                        send(string.Format(CultureInfo.InvariantCulture,
                            "PLACE;Account={0};Instrument={1};Action={2};Qty={3};OrderType=STOP;TIF=GTC;StopPrice={4:F5};OCO={5}",
                            AccountName, inst, exit, contracts, sig.sl, ocoGrp));

                    // TP1 limit (OCO group A — cancels SL when filled, and vice versa)
                    if (sig.tp1 > 0)
                        send(string.Format(CultureInfo.InvariantCulture,
                            "PLACE;Account={0};Instrument={1};Action={2};Qty={3};OrderType=LIMIT;TIF=GTC;LimitPrice={4:F5};OCO={5}",
                            AccountName, inst, exit, contracts, sig.tp1, ocoGrp));
                }

                Print(string.Format(CultureInfo.InvariantCulture,
                    "[CNAX] ✓ {0} {1}× {2}  entry:{3:F4}  sl:{4:F4}  tp1:{5:F4}",
                    action, contracts, inst, sig.entry, sig.sl, sig.tp1));
            }
            catch (Exception ex)
            {
                Print("[CNAX] Order failed: " + ex.Message);
                // MessageBox must run on UI thread
                ChartControl?.Dispatcher.BeginInvoke(new Action(() =>
                    MessageBox.Show(
                        "Order failed. Make sure NT8 ATI is enabled:\n" +
                        "Tools → Options → Automated Trading Interface → Enable ATI.\n\n" +
                        ex.Message,
                        "CNAX Trade Error", MessageBoxButton.OK, MessageBoxImage.Warning)));
            }
        }

        // ── Executed-ID helpers (thread-safe, bounded) ────────────────────────
        private void AddExecuted(string id)
        {
            lock (execLock)
            {
                if (executedIds.Contains(id)) return;
                executedIds.Add(id);
                executedQueue.Enqueue(id);
                // Evict oldest entries to cap memory usage
                while (executedQueue.Count > MaxExecuted)
                    executedIds.Remove(executedQueue.Dequeue());
            }
        }

        private bool IsExecuted(string id)
        {
            lock (execLock) { return executedIds.Contains(id); }
        }

        // ── Symbol / timeframe helpers ────────────────────────────────────────
        private string MapToFutures()
        {
            string mapped;
            return FuturesMap.TryGetValue(Instrument.MasterInstrument.Name, out mapped) ? mapped : null;
        }

        // Case-insensitive; handles 1m, 5m, 15m, 30m, 1H/1h, 4H/4h.
        // Returns true if signal has no timeframe (no filter) or matches chart period.
        private bool TFMatch(string tf)
        {
            if (string.IsNullOrEmpty(tf)) return true;
            if (BarsPeriod.BarsPeriodType != BarsPeriodType.Minute) return false;
            string t = tf.ToLowerInvariant();
            return (t == "1m"  && BarsPeriod.Value == 1)
                || (t == "5m"  && BarsPeriod.Value == 5)
                || (t == "15m" && BarsPeriod.Value == 15)
                || (t == "30m" && BarsPeriod.Value == 30)
                || (t == "1h"  && BarsPeriod.Value == 60)
                || (t == "4h"  && BarsPeriod.Value == 240);
        }

        private static string SigId(CnaxSignal s) =>
            string.IsNullOrEmpty(s.id) ? s.timestamp : s.id;

        // ── Properties ───────────────────────────────────────────────────────
        [NinjaScriptProperty]
        [NinjaTrader.Gui.PropertyEditor.Range(1024, 65535)]
        [NinjaTrader.Gui.NinjaScript.Display(Name="Port", Order=1, GroupName="CNAX Settings",
            Description="Port the CNAX app listens on (default 4242 — do not change)")]
        public int Port { get; set; }

        [NinjaScriptProperty]
        [NinjaTrader.Gui.PropertyEditor.Range(5, 300)]
        [NinjaTrader.Gui.NinjaScript.Display(Name="Poll Interval (sec)", Order=2, GroupName="CNAX Settings",
            Description="How often the indicator checks for new signals")]
        public int PollSeconds { get; set; }

        [NinjaScriptProperty]
        [NinjaTrader.Gui.PropertyEditor.Range(0, 100)]
        [NinjaTrader.Gui.NinjaScript.Display(Name="Min Confidence %", Order=3, GroupName="CNAX Settings",
            Description="Only show signals at or above this confidence level")]
        public int MinConfidence { get; set; }

        [NinjaScriptProperty]
        [NinjaTrader.Gui.NinjaScript.Display(Name="Show SL / TP Lines", Order=4, GroupName="CNAX Settings",
            Description="Draw stop loss and take profit horizontal lines on chart")]
        public bool ShowSLTP { get; set; }

        [NinjaScriptProperty]
        [NinjaTrader.Gui.NinjaScript.Display(Name="Account Name", Order=5, GroupName="CNAX Settings",
            Description="Your NT8 account name (e.g. Sim101 or your funded account ID)")]
        public string AccountName { get; set; }

        [NinjaScriptProperty]
        [NinjaTrader.Gui.PropertyEditor.Range(0.1, 10.0)]
        [NinjaTrader.Gui.NinjaScript.Display(Name="Risk Per Trade %", Order=6, GroupName="CNAX Settings",
            Description="% of account balance to risk per trade. Contracts are calculated automatically.")]
        public double RiskPercent { get; set; }

        [NinjaScriptProperty]
        [NinjaTrader.Gui.PropertyEditor.Range(1, 50)]
        [NinjaTrader.Gui.NinjaScript.Display(Name="Max Contracts (safety cap)", Order=7, GroupName="CNAX Settings",
            Description="Maximum contracts allowed per trade regardless of account size")]
        public int MaxContracts { get; set; }
    }

    // ── Signal model (matches CNAX app JSON) ──────────────────────────────────
    public class CnaxSignal
    {
        [JsonProperty("id")]        public string id         { get; set; }
        [JsonProperty("symbol")]    public string symbol     { get; set; }
        [JsonProperty("direction")] public string direction  { get; set; }
        [JsonProperty("timeframe")] public string timeframe  { get; set; }
        [JsonProperty("confidence")]public double confidence { get; set; }
        [JsonProperty("entry")]     public double entry      { get; set; }
        [JsonProperty("sl")]        public double sl         { get; set; }
        [JsonProperty("tp1")]       public double tp1        { get; set; }
        [JsonProperty("tp2")]       public double tp2        { get; set; }
        [JsonProperty("rr")]        public double rr         { get; set; }
        [JsonProperty("timestamp")] public string timestamp  { get; set; }
    }
}
